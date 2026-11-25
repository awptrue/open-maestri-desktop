/**
 * Roteador do CLI `omaestri` — porte de `Sources/InterAgent/CLIRouter.swift`.
 *
 * Ponto unico de entrada de todo comando. Um handler que lance nao pode derrubar
 * o processo main nem deixar o CLI pendurado esperando resposta: tudo passa por
 * try/catch em `InterAgentServer.dispatch`.
 *
 * Formato de saida copiado do Swift: texto puro, uma linha por entidade. Erro e
 * `error: <motivo>` no corpo (status HTTP sempre 200) — o CLI repassa isso ao
 * agente, que consegue reagir.
 */

import { CLI_PIPE_NAME } from '@shared/constants'
import type { WorkspaceStore } from '../workspace/workspace-store'
import type { TerminalManager } from '../terminal/terminal-manager'
import type { PersistenceManager } from '../persistence/persistence-manager'
import { describeError, recentLogs } from '../logger'
import { ConnectionRegistry, terminalNames } from '../connection/connection-registry'
import { buildConnectionBanner, formatAskHint } from '../connection/role-injection'
import { interAgentServer } from './server'

export const COMMANDS = 'list ask check note context notify portal debug'

/** Tempo maximo que `ask` espera o agente ficar idle antes de desistir. */
const ASK_IDLE_TIMEOUT_MS = 30_000

/** Linhas devolvidas por `check` quando o chamador nao especifica. */
const CHECK_DEFAULT_LINES = 60

export interface RouterDeps {
  store: WorkspaceStore
  terminals: TerminalManager
  persistence: PersistenceManager
  /**
   * Injetado apenas em teste. Em producao fica indefinido e o roteador usa
   * Electron; sem essa porta, `notify` so seria verificavel com app aberto.
   */
  notifier?: Notifier
}

/**
 * Ponte minima para a notificacao do sistema. `show` devolve promessa porque o
 * caminho real importa `electron` de forma dinamica.
 */
export interface Notifier {
  isSupported(): boolean | Promise<boolean>
  show(title: string, body: string): void | Promise<void>
}

export type Router = (args: string[], terminalId?: string) => Promise<string>

export function createRouter(deps: RouterDeps): Router {
  return async (args, terminalId) => {
    const command = args[0]
    if (!command) return 'error: empty command'

    switch (command) {
      case 'help':
      case '--help':
      case '-h':
        return buildHelp()

      case 'debug':
        return buildDebugInfo(deps, terminalId)

      case 'list':
        return runList(deps, terminalId)

      case 'context':
        return runContext(deps, terminalId)

      case 'ask':
        return runAsk(deps, args.slice(1), terminalId)

      case 'check':
        return runCheck(deps, args.slice(1), terminalId)

      case 'note':
        return runNote(deps, args.slice(1))

      case 'notify':
        return runNotify(deps, args.slice(1), terminalId)

      case 'portal':
        return 'error: portal ainda nao implementado nesta versao.'

      default:
        return `error: unknown command '${command}'. Try 'omaestri list' for available commands.`
    }
  }
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

function runList(deps: RouterDeps, callerId: string | undefined): string {
  const payload = deps.store.getActivePayload()
  const sessions = deps.terminals.all()

  if (!payload) {
    return 'error: nenhum workspace aberto.'
  }
  if (sessions.length === 0) {
    return 'Nenhum terminal conectado neste workspace.'
  }

  const caller = callerId ? callerId.toUpperCase() : undefined
  const lines: string[] = []

  for (const session of sessions) {
    const self = session.id === caller ? ' (voce)' : ''
    const status = session.isRunning ? 'running' : 'exited'
    lines.push(`${session.name}${self} — ${session.agentType} — ${status}`)
    lines.push(`  id: ${session.id}`)
    lines.push(`  cwd: ${session.workingDirectory}`)

    // Conexoes que saem deste terminal: sem isso o agente nao sabe a quem pedir.
    const peers = payload.connections
      .filter((c) => c.terminalIdA === session.id || c.terminalIdB === session.id)
      .map((c) => (c.terminalIdA === session.id ? c.terminalIdB : c.terminalIdA))
      .map((id) => deps.terminals.get(id)?.name ?? id)
    if (peers.length > 0) {
      lines.push(`  conectado a: ${peers.join(', ')}`)
    }
  }

  const notes = payload.nodes.filter((n) => n.content.type === 'stickyNote')
  if (notes.length > 0) {
    lines.push('', 'Notas:')
    for (const note of notes) {
      if (note.content.type !== 'stickyNote') continue
      const name = note.content.value.fileName ?? '(sem arquivo)'
      const linked = payload.noteConnections.some((c) => c.noteNodeId === note.id)
      lines.push(`  ${name}${linked ? '' : ' (nao conectada)'}`)
    }
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// context — o que o agente precisa saber antes de pedir ajuda
// ---------------------------------------------------------------------------

/**
 * Imprime exatamente o banner que o terminal receberia na inicializacao: quem
 * esta conectado, quais notas estao vinculadas e a dica de `ask`. Existe como
 * comando porque o agente pode querer reconferir depois de uma conexao nova.
 */
function runContext(deps: RouterDeps, terminalId: string | undefined): string {
  const payload = deps.store.getActivePayload()
  if (!payload) return 'error: nenhum workspace aberto.'

  const registry = new ConnectionRegistry(payload)
  const names = terminalNames(payload)
  const target = terminalId ? terminalId.toUpperCase() : undefined
  if (!target) return 'error: sem terminal de origem; rode dentro de um terminal do canvas.'

  const banner = buildConnectionBanner(registry, target, names)
  const lines = [banner, formatAskHint()].filter((line) => line !== '')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// ask
// ---------------------------------------------------------------------------

async function runAsk(deps: RouterDeps, rest: string[], callerId: string | undefined): Promise<string> {
  const name = rest[0]
  const prompt = rest[1]
  if (!name || prompt === undefined || prompt === '') {
    return 'error: uso: omaestri ask "Nome" "prompt"'
  }

  const payload = deps.store.getActivePayload()
  if (!payload) return 'error: nenhum workspace aberto.'

  // Escopo: so terminais conectados ao chamador. Sem isso um agente poderia
  // comandar qualquer terminal do canvas, inclusive fora da sua area.
  const caller = callerId ? deps.terminals.get(callerId) : undefined
  let restrictTo: Set<string> | undefined
  if (caller) {
    restrictTo = new Set<string>()
    for (const c of payload.connections) {
      if (c.terminalIdA === caller.id) restrictTo.add(c.terminalIdB)
      if (c.terminalIdB === caller.id) restrictTo.add(c.terminalIdA)
    }
  }

  const target = deps.terminals.findByName(name, restrictTo)
  if (!target) {
    return restrictTo
      ? `error: nenhum agente conectado chamado '${name}'. Rode 'omaestri list' para ver os conectados.`
      : `error: agente '${name}' nao encontrado. Rode 'omaestri list'.`
  }
  if (!target.isRunning) {
    return `error: '${target.name}' nao esta em execucao.`
  }
  if (target.id === caller?.id) {
    return 'error: nao e possivel enviar um prompt para si mesmo.'
  }

  target.markActiveTask()
  // `\r` e o Enter do terminal (nao `\n`: o ConPTY trata os dois, mas agentes
  // TUI reagem so ao CR).
  target.write(`${prompt}\r`)

  const { timedOut } = await target.waitForIdle(ASK_IDLE_TIMEOUT_MS)
  const output = tailLines(target, 200)
  const header = timedOut
    ? `[aviso: '${target.name}' nao ficou idle em ${ASK_IDLE_TIMEOUT_MS / 1000}s; devolvendo a saida atual]`
    : `[resposta de '${target.name}']`

  return `${header}\n${output || '(sem saida)'}`
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

function runCheck(deps: RouterDeps, rest: string[], callerId: string | undefined): string {
  const name = rest[0]
  if (!name) return 'error: uso: omaestri check "Nome" [linhas]'

  // Mesmo escopo de `ask`: o agente so le a saida de terminais conectados a ele.
  // Sem isso `check` viraria um `tail -f` de qualquer no do canvas.
  const payload = deps.store.getActivePayload()
  const caller = callerId ? deps.terminals.get(callerId) : undefined
  let restrictTo: Set<string> | undefined
  if (caller) {
    restrictTo = new Set<string>()
    for (const c of payload?.connections ?? []) {
      if (c.terminalIdA === caller.id) restrictTo.add(c.terminalIdB)
      if (c.terminalIdB === caller.id) restrictTo.add(c.terminalIdA)
    }
  }

  const target = deps.terminals.findByName(name, restrictTo)
  if (!target) {
    return restrictTo
      ? `error: nenhum agente conectado chamado '${name}'. Rode 'omaestri list' para ver os conectados.`
      : `error: agente '${name}' nao encontrado. Rode 'omaestri list'.`
  }

  const requested = Number.parseInt(rest[1] ?? '', 10)
  const lines = Number.isFinite(requested) && requested > 0 ? requested : CHECK_DEFAULT_LINES
  const output = tailLines(target, lines)
  // Terminal vivo pode estar sem saida nova: dizer isso evita o chamador
  // interpretar vazio como erro.
  return output || '(sem saida)'
}

function tailLines(target: { bufferLines(): string[] }, count: number): string {
  const lines = target.bufferLines()
  return lines.slice(-count).join('\n')
}

// ---------------------------------------------------------------------------
// note
// ---------------------------------------------------------------------------

async function runNote(deps: RouterDeps, rest: string[]): Promise<string> {
  const action = rest[0]
  const name = rest[1]
  if (!action) return 'error: uso: omaestri note read|write|edit "Nome" [...]'

  const payload = deps.store.getActivePayload()
  if (!payload) return 'error: nenhum workspace aberto.'

  // Resolver a nota pelo fileName ou pelo texto do cabecalho, como o original.
  const note = payload.nodes.find((n) => {
    if (n.content.type !== 'stickyNote') return false
    const file = n.content.value.fileName ?? ''
    return file.replace(/\.md$/i, '').toLowerCase() === (name ?? '').toLowerCase()
  })
  if (!name || !note || note.content.type !== 'stickyNote' || !note.content.value.fileName) {
    return `error: nota '${name ?? ''}' nao encontrada. Rode 'omaestri list'.`
  }

  const fileName = note.content.value.fileName
  const workspaceId = payload.id

  switch (action) {
    case 'read':
      return (await deps.store.readNote(workspaceId, fileName)) || '(nota vazia)'

    case 'write': {
      const content = rest[2]
      if (content === undefined) return 'error: uso: omaestri note write "Nome" "texto"'
      await deps.store.writeNote(workspaceId, fileName, content)
      return `ok: nota '${fileName}' gravada (${content.length} bytes)`
    }

    case 'edit': {
      const from = rest[2]
      const to = rest[3]
      if (from === undefined || to === undefined) {
        return 'error: uso: omaestri note edit "Nome" "antigo" "novo"'
      }
      const current = await deps.store.readNote(workspaceId, fileName)
      if (!current.includes(from)) {
        return `error: trecho nao encontrado em '${fileName}'.`
      }
      const next = current.replace(from, to)
      await deps.store.writeNote(workspaceId, fileName, next)
      return `ok: nota '${fileName}' editada`
    }

    default:
      return `error: acao de nota desconhecida '${action}'. Use read, write ou edit.`
  }
}

// ---------------------------------------------------------------------------
// notify
// ---------------------------------------------------------------------------

/**
 * Notificacao do sistema. No macOS o original usa `NSUserNotification`; aqui e
 * `Notification` do Electron. Sem texto nao ha o que mostrar: erro explicito em
 * vez de notificacao vazia.
 */
async function runNotify(
  deps: RouterDeps,
  rest: string[],
  terminalId: string | undefined,
): Promise<string> {
  const message = rest[0]
  if (!message) return 'error: uso: omaestri notify "mensagem"'

  const notifier = deps.notifier ?? electronNotifier()
  try {
    if (!(await notifier.isSupported())) {
      return 'error: notificacoes nao suportadas neste sistema.'
    }
    const sender = terminalId ? ` (de ${terminalId})` : ''
    await notifier.show('open-maestri', `${message}${sender}`)
    return 'ok: notificacao enviada'
  } catch (e) {
    return `error: notificacao indisponivel: ${describeError(e)}`
  }
}

/**
 * Caminho real. Import dinamico porque o roteador tambem roda em teste sem app
 * do Electron pronto.
 */
function electronNotifier(): Notifier {
  return {
    async isSupported() {
      const { Notification } = await import('electron')
      return Notification.isSupported()
    },
    async show(title, body) {
      const { Notification } = await import('electron')
      new Notification({ title, body }).show()
    },
  }
}

// ---------------------------------------------------------------------------
// help / debug
// ---------------------------------------------------------------------------

function buildHelp(): string {
  return [
    'Uso: omaestri <comando>',
    '',
    '  list                          lista agentes, portais e notas conectados',
    '  ask "Nome" "prompt"           envia prompt a um agente conectado',
    '  check "Nome" [linhas]         le a saida atual do agente',
    '  context                       mostra conexoes e notas deste terminal',
    '  note read "Nome"              le uma nota',
    '  note write "Nome" "texto"     substitui o conteudo da nota',
    '  note edit "Nome" "a" "b"      substitui um trecho da nota',
    '  notify "mensagem"             notificacao do sistema',
    '  debug                         diagnostico do servidor',
    '',
    'Escopo: ask e check so alcancam terminais CONECTADOS ao chamador no canvas.',
    '',
    `Commands: ${COMMANDS}`,
  ].join('\n')
}

function buildDebugInfo(deps: RouterDeps, terminalId: string | undefined): string {
  const payload = deps.store.getActivePayload()
  const lines = [
    'open-maestri inter-agent server debug:',
    `  HTTP port:     ${interAgentServer.port || '(nao iniciado)'}`,
    `  Named pipe:    ${CLI_PIPE_NAME}`,
    `  Pipe status:   ${interAgentServer.pipeUnavailable ? 'ocupado por outra instancia' : 'escutando'}`,
    `  Terminal ID:   ${terminalId ?? '(none)'}`,
    `  Workspace:     ${payload ? `${payload.name} (${payload.id}, ${payload.nodes.length} nos)` : '(nenhum aberto)'}`,
    `  Terminais:     ${deps.terminals.all().length}`,
    `  Commands:      ${COMMANDS}`,
  ]
  const recent = recentLogs(10)
  if (recent.length > 0) {
    lines.push('', 'Ultimas linhas de log:')
    for (const line of recent) lines.push(`  ${line}`)
  }
  return lines.join('\n')
}

/** Instala o roteador no servidor. Chamado uma vez no bootstrap. */
export function installRouter(deps: RouterDeps): void {
  interAgentServer.setRouter(createRouter(deps))
}

/** Mantido para o bootstrap nao depender de `./server` para isso. */
export function installMissingRouter(error: string): void {
  interAgentServer.setRouter(async () => error)
}

export { describeError }
