/**
 * Servidor local do CLI `omaestri`.
 *
 * Dois transportes, como no original (InterAgentServer.swift):
 *  - HTTP em 127.0.0.1 numa porta dinamica
 *  - named pipe `\\.\pipe\omaestri-agent` (equivalente ao Unix socket do macOS)
 *
 * Protocolo identico: POST /cli, header X-Terminal-ID, body {"args":[...]},
 * resposta text/plain com status sempre 200.
 *
 * Seguranca: nada escuta fora do loopback; o pipe e local por natureza.
 */

import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net'

import { CLI_PIPE_NAME, CLI_PIPE_PATH, INTER_AGENT_HOST } from '@shared/constants'
import { createLogger } from '../logger'

const log = createLogger('InterAgentServer')

/** 1 MB — acomoda comandos `portal evaluate` com scripts grandes. */
const MAX_REQUEST_BYTES = 1024 * 1024
const MAX_RESTARTS = 5
const RESTART_DELAY_MS = 3000

export interface ParsedRequest {
  args: string[]
  terminalId?: string
  httpVersion: '1.0' | '1.1'
}

export type CommandRouter = (args: string[], terminalId?: string) => Promise<string>

/**
 * Parser HTTP usado no caminho do named pipe: o Node expoe pipes nomeados com a
 * API de sockets, entao o parser e escrito a mao em vez de usar `node:http`.
 */
export function parseHttpRequest(raw: string): ParsedRequest | undefined {
  const split = raw.indexOf('\r\n\r\n')
  if (split < 0) return undefined

  const headerBlock = raw.slice(0, split)
  const body = raw.slice(split + 4)
  const lines = headerBlock.split('\r\n')

  const requestLine = lines[0] ?? ''
  const httpVersion = requestLine.includes('HTTP/1.0') ? '1.0' : '1.1'

  let terminalId: string | undefined
  for (const line of lines.slice(1)) {
    const lower = line.toLowerCase()
    if (lower.startsWith('x-terminal-id:')) {
      terminalId = line.slice('x-terminal-id:'.length).trim().toUpperCase()
    }
  }

  let args: string[] = []
  try {
    const json = JSON.parse(body) as { args?: unknown }
    if (Array.isArray(json.args)) args = json.args.filter((a): a is string => typeof a === 'string')
  } catch {
    // corpo invalido -> args vazio, tratado pelo chamador
  }

  return { args, terminalId, httpVersion }
}

export function contentLengthOf(headerBlock: string): number {
  for (const line of headerBlock.split('\r\n')) {
    const lower = line.toLowerCase()
    if (lower.startsWith('content-length:')) {
      return Number.parseInt(line.slice('content-length:'.length).trim(), 10) || 0
    }
  }
  return 0
}

export function buildResponse(body: string, httpVersion = '1.1'): Buffer {
  const payload = Buffer.from(body, 'utf8')
  const header =
    `HTTP/${httpVersion} 200 OK\r\n` +
    'Content-Type: text/plain; charset=utf-8\r\n' +
    `Content-Length: ${payload.length}\r\n` +
    'Connection: close\r\n\r\n'
  return Buffer.concat([Buffer.from(header, 'utf8'), payload])
}

export class InterAgentServer {
  private http?: HttpServer
  private pipe?: NetServer
  private restarts = 0
  private router?: CommandRouter
  private readonly restartTimers = new Set<NodeJS.Timeout>()
  private stopped = false

  port = 0
  /** true quando outra instancia ja detem o named pipe. */
  pipeUnavailable = false

  setRouter(router: CommandRouter): void {
    this.router = router
  }

  async start(): Promise<void> {
    await this.startHttp()
    await this.startPipe()
  }

  private startHttp(): Promise<void> {
    return new Promise((resolve) => {
      const server = createHttpServer((req, res) => {
        if (req.method !== 'POST' || !req.url?.startsWith('/cli')) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('not found')
          return
        }

        const chunks: Buffer[] = []
        let size = 0
        req.on('data', (c: Buffer) => {
          size += c.length
          if (size > MAX_REQUEST_BYTES) {
            res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('requisicao grande demais')
            req.destroy()
            return
          }
          chunks.push(c)
        })
        req.on('end', () => {
          void (async () => {
            const terminalId = (req.headers['x-terminal-id'] as string | undefined)?.toUpperCase()
            let args: string[] = []
            try {
              const json = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { args?: unknown }
              if (Array.isArray(json.args)) args = json.args.filter((a): a is string => typeof a === 'string')
            } catch {
              // args vazio
            }
            const body = await this.dispatch(args, terminalId)
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end(body)
          })()
        })
      })

      let settled = false
      const settle = (): void => {
        if (settled) return
        settled = true
        resolve()
      }

      server.on('error', (e) => {
        log.error(`servidor HTTP falhou: ${describeError(e)}`)
        this.scheduleHttpRestart()
        // Nunca deixar o bootstrap pendurado: sem isso a janela nunca abre.
        settle()
      })

      // porta 0 = o SO escolhe uma livre
      server.listen(0, INTER_AGENT_HOST, () => {
        const addr = server.address()
        this.port = typeof addr === 'object' && addr ? addr.port : 0
        this.restarts = 0
        this.http = server
        log.info(`HTTP pronto em ${INTER_AGENT_HOST}:${this.port}`)
        settle()
      })
    })
  }

  private startPipe(): Promise<void> {
    return new Promise((resolve) => {
      const server = createNetServer((socket) => this.handlePipeClient(socket))

      let settled = false
      const settle = (): void => {
        if (settled) return
        settled = true
        resolve()
      }

      server.on('error', (e) => {
        const code = (e as NodeJS.ErrnoException).code
        if (code === 'EADDRINUSE') {
          this.pipeUnavailable = true
          log.error(
            `named pipe ${CLI_PIPE_NAME} ja esta em uso — outra instancia do open-maestri esta aberta. ` +
              'Os comandos omaestri desta janela iriam para ela; feche a outra instancia.',
          )
        } else {
          log.error(`named pipe falhou: ${describeError(e)}`)
          this.schedulePipeRestart()
        }
        settle()
      })

      server.listen(CLI_PIPE_PATH, () => {
        this.pipe = server
        log.info(`named pipe pronto em ${CLI_PIPE_PATH}`)
        settle()
      })
    })
  }

  private handlePipeClient(socket: Socket): void {
    let buffer = ''
    let handled = false

    socket.setEncoding('utf8')
    socket.on('error', () => socket.destroy())

    const tryHandle = (): void => {
      if (handled) return
      const split = buffer.indexOf('\r\n\r\n')
      if (split < 0) return

      const expected = contentLengthOf(buffer.slice(0, split))
      const received = Buffer.byteLength(buffer.slice(split + 4), 'utf8')
      if (expected > 0 && received < expected) return

      handled = true
      const parsed = parseHttpRequest(buffer)
      void (async () => {
        const body = await this.dispatch(parsed?.args ?? [], parsed?.terminalId)
        socket.end(buildResponse(body, parsed?.httpVersion ?? '1.0'))
      })()
    }

    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (Buffer.byteLength(buffer, 'utf8') > MAX_REQUEST_BYTES) {
        socket.destroy()
        return
      }
      tryHandle()
    })

    socket.on('end', () => tryHandle())
  }

  /**
   * Todo comando passa por aqui. Um handler que lance nunca pode derrubar o
   * main nem deixar o CLI pendurado esperando resposta.
   */
  private async dispatch(args: string[], terminalId?: string): Promise<string> {
    if (args.length === 0) return 'error: missing args'
    if (!this.router) {
      // Nao engolir silenciosamente: sem roteador nada funciona, e a causa
      // precisa chegar ao agente que chamou o CLI.
      log.error('comando recebido sem roteador instalado — bootstrap incompleto')
      return 'error: servidor sem roteador — bootstrap incompleto'
    }
    try {
      return await this.router(args, terminalId)
    } catch (e) {
      log.error(`comando '${args[0]}' falhou: ${describeError(e)}`)
      return `error: comando '${args[0]}' falhou: ${describeError(e)}`
    }
  }

  private scheduleHttpRestart(): void {
    if (this.stopped) return
    if (this.restarts >= MAX_RESTARTS) {
      log.error(`limite de ${MAX_RESTARTS} reinicios atingido — desistindo`)
      return
    }
    const delay = RESTART_DELAY_MS * 2 ** this.restarts
    this.restarts++
    log.warn(`reiniciando HTTP em ${Math.round(delay / 1000)}s (tentativa ${this.restarts})`)
    const t = setTimeout(() => void this.startHttp(), delay)
    t.unref?.()
    this.restartTimers.add(t)
  }

  private schedulePipeRestart(): void {
    if (this.stopped || this.restarts >= MAX_RESTARTS) return
    const delay = RESTART_DELAY_MS * 2 ** this.restarts
    this.restarts++
    log.warn(`reiniciando named pipe em ${Math.round(delay / 1000)}s`)
    const t = setTimeout(() => void this.startPipe(), delay)
    t.unref?.()
    this.restartTimers.add(t)
  }

  async stop(): Promise<void> {
    // Sem isso, um quit durante o backoff reabriria HTTP/pipe depois do
    // encerramento, mantendo o processo vivo e o pipe roubado.
    this.stopped = true
    for (const timer of this.restartTimers) clearTimeout(timer)
    this.restartTimers.clear()
    await Promise.all([
      new Promise<void>((r) => (this.http ? this.http.close(() => r()) : r())),
      new Promise<void>((r) => (this.pipe ? this.pipe.close(() => r()) : r())),
    ])
    this.http = undefined
    this.pipe = undefined
    this.port = 0
    this.pipeUnavailable = false
    log.info('servidor encerrado')
  }
}

export function describeError(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

export const interAgentServer = new InterAgentServer()
