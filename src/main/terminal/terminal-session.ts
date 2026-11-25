import { EventEmitter } from 'node:events'
import { basename } from 'node:path'
import type { IPty } from '@lydell/node-pty'
import type { Terminal as HeadlessTerminalInstance } from '@xterm/headless'

import { AGENT_IDLE_TIMEOUT_MS, MAX_SCROLLBACK_LINES } from '@shared/constants'
import type { AgentType } from '@shared/models/node-content'
import { createLogger, describeError } from '../logger'
import { buildLaunchInput } from './agent-launch'
import { load, save } from './scrollback-store'
import { resolveShell } from './shell-resolver'

const AGENT_LAUNCH_DELAY_MS = 600
const SCROLLBACK_FLUSH_MS = 5000

export interface TerminalSessionOptions {
  id: string
  name: string
  agentType: AgentType
  command?: string
  shellPath?: string
  shellLabel?: string
  workingDirectory: string
  cols: number
  rows: number
  env: NodeJS.ProcessEnv
  scrollbackPath?: string
}

export interface TerminalExitEvent {
  exitCode: number
  signal?: number
}

type TerminalEvents = { data: [string]; exit: [TerminalExitEvent]; idle: [] }

export class TerminalSession {
  readonly id: string
  readonly name: string
  readonly agentType: AgentType
  readonly workingDirectory: string

  private readonly log: ReturnType<typeof createLogger>
  private readonly events = new EventEmitter<TerminalEvents>()
  private readonly subscriptions: Array<{ dispose(): void }>
  private readonly idleWaiters = new Set<(timedOut: boolean) => void>()
  private running = true
  private disposed = false
  private hasActiveTask = false
  private lastOutputAt = 0
  private idleTimer?: NodeJS.Timeout
  private pendingWrites = 0
  private pendingExit?: TerminalExitEvent
  private launchTimer?: NodeJS.Timeout
  private readonly scrollbackPath?: string
  private scrollbackTimer?: NodeJS.Timeout
  private scrollbackDirty = false

  private constructor(
    opts: TerminalSessionOptions,
    private readonly pty: IPty,
    private readonly terminal: HeadlessTerminalInstance,
  ) {
    this.id = opts.id.toUpperCase()
    this.name = opts.name
    this.agentType = opts.agentType
    this.workingDirectory = opts.workingDirectory
    this.log = createLogger(`Terminal:${opts.name}`)
    this.scrollbackPath = opts.scrollbackPath
    this.subscriptions = [
      pty.onData((data) => this.handleData(data)),
      pty.onExit((event) => {
        this.running = false
        clearTimeout(this.launchTimer)
        this.pendingExit = event
        this.afterWrite()
      }),
    ]
    if (this.scrollbackPath) {
      this.scrollbackTimer = setInterval(() => this.flushScrollback(), SCROLLBACK_FLUSH_MS).unref()
    }
    const launchInput = buildLaunchInput(opts.shellLabel, opts.command)
    if (launchInput !== undefined && this.running) {
      this.launchTimer = setTimeout(() => {
        this.launchTimer = undefined
        try {
          this.write(launchInput)
        } catch (error) {
          this.log.warn(`Falha ao enviar comando de agente ao PTY: ${describeError(error)}`)
        }
      }, AGENT_LAUNCH_DELAY_MS).unref()
    }
  }

  static async create(opts: TerminalSessionOptions): Promise<TerminalSession> {
    const customShellLabel = basename(opts.shellPath ?? '').replace(/\.exe$/i, '').toLowerCase()
    const shell = opts.shellPath
      ? {
          file: opts.shellPath,
          args: /^(pwsh|powershell)$/.test(customShellLabel) ? ['-NoLogo'] : [],
          label: customShellLabel,
        }
      : resolveShell()
    const pty = await import('@lydell/node-pty')
    const headless = await import('@xterm/headless')
    const HeadlessTerminal = headless.Terminal ?? headless.default.Terminal
    const terminal = new HeadlessTerminal({
      cols: opts.cols,
      rows: opts.rows,
      scrollback: MAX_SCROLLBACK_LINES,
      allowProposedApi: true,
    })

    let process: IPty
    try {
      if (opts.scrollbackPath) {
        const lines = await load(opts.scrollbackPath)
        if (lines.length > 0) {
          await new Promise<void>((resolve) => terminal.write(`${lines.join('\r\n')}\r\n`, resolve))
        }
      }
      process = pty.spawn(shell.file, shell.args, {
        name: 'xterm-256color',
        cols: opts.cols,
        rows: opts.rows,
        cwd: opts.workingDirectory,
        env: opts.env,
      })
    } catch (error) {
      terminal.dispose()
      createLogger(`Terminal:${opts.name}`).error(`Falha ao iniciar PTY: ${describeError(error)}`)
      throw error
    }
    return new TerminalSession({ ...opts, shellLabel: opts.shellLabel ?? shell.label }, process, terminal)
  }

  get isRunning(): boolean {
    return this.running
  }

  get lineCount(): number {
    return this.bufferLines().length
  }

  write(data: string): void {
    if (this.running) this.pty.write(data)
  }

  resize(cols: number, rows: number): void {
    if (!this.running) return
    this.pty.resize(cols, rows)
    this.terminal.resize(cols, rows)
  }

  snapshot(): string {
    return this.bufferLines().join('\n')
  }

  bufferLines(): string[] {
    return this.disposed ? [] : this.readBufferLines()
  }

  private readBufferLines(): string[] {
    const buffer = this.terminal.buffer.active
    const lines: string[] = []
    for (let index = 0; index < buffer.length; index++) {
      lines.push(buffer.getLine(index)?.translateToString(true) ?? '')
    }
    while (lines.at(-1) === '') lines.pop()
    return lines
  }

  markActiveTask(): void {
    if (!this.running) return
    this.lastOutputAt = Date.now()
    this.hasActiveTask = true
    this.scheduleIdle()
  }

  waitForIdle(timeoutMs: number): Promise<{ timedOut: boolean }> {
    if (!this.hasActiveTask) return Promise.resolve({ timedOut: false })

    return new Promise((resolve) => {
      const finish = (timedOut: boolean): void => {
        clearTimeout(timeout)
        this.idleWaiters.delete(finish)
        resolve({ timedOut })
      }
      const timeout = setTimeout(() => finish(true), timeoutMs)
      this.idleWaiters.add(finish)
    })
  }

  onData(callback: (data: string) => void): () => void {
    return this.subscribe('data', callback)
  }

  onExit(callback: (event: TerminalExitEvent) => void): () => void {
    return this.subscribe('exit', callback)
  }

  onIdle(callback: () => void): () => void {
    return this.subscribe('idle', callback)
  }

  kill(): void {
    if (this.disposed) return
    const shouldKill = this.running
    this.disposed = true
    this.running = false
    this.pendingExit = undefined
    clearTimeout(this.launchTimer)
    clearInterval(this.scrollbackTimer)
    this.finishTask()
    this.events.removeAllListeners()
    for (const subscription of this.subscriptions.splice(0)) subscription.dispose()
    if (!this.scrollbackPath || this.pendingWrites === 0) this.disposeTerminal()

    if (shouldKill) {
      try {
        this.pty.kill()
      } catch (error) {
        this.log.warn(`Falha ao encerrar PTY: ${describeError(error)}`)
      }
    }
  }

  private subscribe<EventName extends keyof TerminalEvents>(
    event: EventName,
    callback: (...args: TerminalEvents[EventName]) => void,
  ): () => void {
    // O EventEmitter generico do Node nao estreita o par (evento, callback) por
    // uniao de chaves; a assinatura publica acima ja garante o pareamento.
    const emitter = this.events as EventEmitter
    if (!this.disposed) emitter.on(event, callback)
    return () => {
      emitter.off(event, callback)
    }
  }

  private handleData(data: string): void {
    if (this.disposed) return
    this.lastOutputAt = Date.now()
    this.pendingWrites++
    this.terminal.write(data, () => {
      this.pendingWrites--
      this.scrollbackDirty = true
      if (this.disposed) {
        if (this.scrollbackPath && this.pendingWrites === 0) this.disposeTerminal()
        return
      }
      try {
        this.events.emit('data', data)
      } finally {
        this.afterWrite()
      }
    })
  }

  private afterWrite(): void {
    if (this.pendingWrites !== 0) return
    const exit = this.pendingExit
    if (exit) {
      this.pendingExit = undefined
      this.finishTask()
      this.events.emit('exit', exit)
    } else {
      this.scheduleIdle()
    }
  }

  private flushScrollback(): void {
    if (!this.scrollbackPath || !this.scrollbackDirty) return
    this.scrollbackDirty = false
    void save(this.scrollbackPath, this.readBufferLines()).catch((error: unknown) => {
      this.scrollbackDirty = true
      this.log.warn(`Falha ao gravar scrollback: ${describeError(error)}`)
    })
  }

  private disposeTerminal(): void {
    this.flushScrollback()
    this.terminal.dispose()
  }

  private scheduleIdle(): void {
    clearTimeout(this.idleTimer)
    this.idleTimer = undefined
    if (!this.running || !this.hasActiveTask || this.pendingWrites !== 0) return

    const remaining = Math.max(0, AGENT_IDLE_TIMEOUT_MS - (Date.now() - this.lastOutputAt))
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined
      if (this.pendingWrites !== 0) return
      if (Date.now() - this.lastOutputAt < AGENT_IDLE_TIMEOUT_MS) {
        this.scheduleIdle()
        return
      }
      this.finishTask()
      this.events.emit('idle')
    }, remaining)
  }

  private finishTask(): void {
    clearTimeout(this.idleTimer)
    this.idleTimer = undefined
    this.hasActiveTask = false
    for (const finish of this.idleWaiters) finish(false)
  }
}
