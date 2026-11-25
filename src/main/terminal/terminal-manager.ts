import { delimiter, join } from 'node:path'

import { CLI_PIPE_NAME } from '@shared/constants'
import { TerminalSession, type TerminalSessionOptions } from './terminal-session'

export type TerminalCreateOptions = Omit<TerminalSessionOptions, 'env'> & { env?: NodeJS.ProcessEnv }

function isPath(key: string): boolean {
  return key.toLowerCase() === 'path'
}

/**
 * Nome do shim que `installCli()` grava em `<root>/bin`. Precisamos saber o
 * nome do arquivo para apontar `MAESTRI_CLI` para o caminho absoluto — e o que
 * salva o agente de um shell que reseta o PATH.
 */
function cliExecutable(cliDir: string): string {
  return join(cliDir, process.platform === 'win32' ? 'omaestri.cmd' : 'omaestri')
}

/**
 * Monta o ambiente do PTY. Exportada para teste: o que importa aqui e o PATH
 * com os shims e o `MAESTRI_CLI`, e provar isso sem abrir janela exige chamar
 * esta funcao direto.
 */
export function createEnvironment(
  id: string,
  port?: number,
  overrides: NodeJS.ProcessEnv = {},
  cliDir?: string,
): NodeJS.ProcessEnv {
  const env = {
    ...process.env,
    ...overrides,
    MAESTRI_TERMINAL_ID: id,
    OMAESTRI_TERMINAL_ID: id,
    MAESTRI_PIPE: CLI_PIPE_NAME,
    TERM: 'xterm-256color',
  } as NodeJS.ProcessEnv
  if (port === undefined) delete env.MAESTRI_SERVER_PORT
  else env.MAESTRI_SERVER_PORT = String(port)

  if (process.platform === 'win32') {
    const overrideKey = Object.keys(overrides).find(isPath)
    const pathKey = Object.keys(process.env).find(isPath) ?? overrideKey
    if (pathKey !== undefined) {
      const path = overrideKey === undefined ? process.env[pathKey] : overrides[overrideKey]
      for (const key of Object.keys(env)) {
        if (key !== pathKey && isPath(key)) delete env[key]
      }
      env[pathKey] = path
    }
  }

  // O diretorio dos shims entra no INICIO do PATH: sem isso o agente recebe
  // `omaestri` nao encontrado e nunca descobre que existe comunicacao entre nos.
  if (cliDir !== undefined && cliDir !== '') {
    const pathKey = Object.keys(env).find(isPath) ?? 'PATH'
    const current = env[pathKey]
    env[pathKey] = current === undefined || current === '' ? cliDir : `${cliDir}${delimiter}${current}`
    env.MAESTRI_CLI = cliExecutable(cliDir)
  }
  return env
}

export class TerminalManager {
  private readonly sessions = new Map<string, TerminalSession>()
  private readonly pending = new Map<string, symbol>()
  private httpPort?: number
  private cliDir?: string

  async create(opts: TerminalCreateOptions): Promise<TerminalSession> {
    const id = opts.id.toUpperCase()
    if (this.sessions.has(id) || this.pending.has(id)) {
      throw new Error(`Sessao de terminal ja existe: ${id}`)
    }

    const request = Symbol(id)
    this.pending.set(id, request)
    try {
      const env = createEnvironment(id, this.httpPort, opts.env, this.cliDir)
      const session = await TerminalSession.create({ ...opts, id, env })
      if (this.pending.get(id) !== request) {
        session.kill()
        throw new Error(`Criacao da sessao de terminal cancelada: ${id}`)
      }
      this.sessions.set(id, session)
      return session
    } finally {
      if (this.pending.get(id) === request) this.pending.delete(id)
    }
  }

  get(id: string): TerminalSession | undefined {
    return this.sessions.get(id.toUpperCase())
  }

  all(): TerminalSession[] {
    return Array.from(this.sessions.values())
  }

  findByName(name: string, restrictTo?: Set<string>): TerminalSession | undefined {
    const query = name.toLowerCase()
    if (!query) return undefined
    const allowed = restrictTo && new Set(Array.from(restrictTo, (id) => id.toUpperCase()))
    let partial: TerminalSession | undefined
    for (const session of this.sessions.values()) {
      if (allowed && !allowed.has(session.id)) continue
      const candidate = session.name.toLowerCase()
      if (candidate === query) return session
      if (!partial && candidate.includes(query)) partial = session
    }
    return partial
  }

  destroy(id: string): void {
    const key = id.toUpperCase()
    this.pending.delete(key)
    const session = this.sessions.get(key)
    this.sessions.delete(key)
    session?.kill()
  }

  destroyAll(): void {
    this.pending.clear()
    for (const id of this.sessions.keys()) this.destroy(id)
  }

  setHttpPort(port: number): void {
    this.httpPort = port
  }

  /** Diretorio dos shims do CLI. Vem de `installCli()` no boot. */
  setCliDir(dir: string): void {
    this.cliDir = dir
  }
}

export const terminalManager = new TerminalManager()
