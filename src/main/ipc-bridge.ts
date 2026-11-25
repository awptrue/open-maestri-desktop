/**
 * Ponte IPC do processo principal.
 *
 * Toda chamada do renderer cai aqui. O renderer nunca escreve JSON: ele envia
 * intencao e o main persiste via `WorkspaceStore`/`PersistenceManager`.
 *
 * Regra de identidade: um terminal e chaveado por `TerminalContent.id` (o id que
 * o `workspace.json` usa em `connections` e no CLI), nunca pelo id do no.
 */

import { app, BrowserWindow, ipcMain } from 'electron'

import { IPC } from '@shared/ipc-channels'
import type {
  CreateNodeRequest,
  FileTreeListRequest,
  NoteReadRequest,
  NoteWriteRequest,
  OpenWorkspaceRequest,
  SetViewportRequest,
  TerminalCreateRequest,
  TerminalCreateResult,
  TerminalInputRequest,
  TerminalResizeRequest,
  TerminalSnapshotRequest,
  TerminalSnapshotResult,
  UpdateNodeFrameRequest,
  WorkspaceSnapshot,
} from '@shared/ipc-contract'
import type { AgentType, NodeContent } from '@shared/models/node-content'
import {
  createFileTreeContent,
  createPortalContent,
  createStickyNoteContent,
  createTerminalContent,
  createTextContent,
} from '@shared/models/node-content'
import { newId } from '@shared/models/codec'
import { sanitizeFileName } from './paths'
import type { WorkspaceStore } from './workspace/workspace-store'
import type { TerminalManager } from './terminal/terminal-manager'
import type { TerminalSession } from './terminal/terminal-session'
import { getMainWindow } from './window'
import { createLogger } from './logger'
import { listDirectory, watchDirectory, unwatchDirectory } from './filetree/file-tree'

const log = createLogger('IpcBridge')

export interface BridgeDeps {
  store: WorkspaceStore
  terminals: TerminalManager
  /** Resolve `.../workspaces/<ID>/terminals/<TERMINAL>.scrollback`. */
  scrollbackPath(workspaceId: string, terminalId: string): string
}

/** Sessao PTY viva por terminalId, para nao recriar ao remontar o no. */
const attached = new Set<string>()

/**
 * Criacoes de PTY em andamento. O React monta o no duas vezes em
 * desenvolvimento (StrictMode) e manda dois `terminal.create` concorrentes; sem
 * compartilhar a promessa, o segundo bate na trava do manager e o no abre com
 * erro em vez de terminal.
 */
const creatingTerminals = new Map<string, Promise<TerminalSession>>()

/** Criacao de workspace em andamento, compartilhada entre chamadas concorrentes. */
let creating: Promise<import('@shared/models/workspace').WorkspaceDocument> | undefined

export function registerIpcBridge(deps: BridgeDeps): void {
  const { store, terminals, scrollbackPath } = deps

  /** Caminho do scrollback do terminal no workspace ativo, se houver workspace. */
  const scrollbackPathFor = (terminalId: string): string | undefined => {
    const workspaceId = store.getActivePayload()?.id
    if (!workspaceId) return undefined
    return scrollbackPath(workspaceId, terminalId)
  }

  ipcMain.handle(IPC.APP_GET_VERSION, () => app.getVersion())
  ipcMain.handle(IPC.APP_GET_PLATFORM, () => process.platform)

  /**
   * Nota gravada pelo CLI: avisa o renderer para a nota aberta recarregar.
   * Escritas do proprio editor passam com `notify = false` e nao chegam aqui.
   */
  store.onNoteWritten((workspaceId, fileName) => {
    const activeId = store.getActivePayload()?.id
    if (activeId !== undefined && activeId.toUpperCase() !== workspaceId) return
    broadcast(IPC.NOTE_CHANGED, { fileName })
  })

  ipcMain.on(IPC.WIN_MINIMIZE, () => {
    getMainWindow()?.minimize()
  })

  ipcMain.on(IPC.WIN_MAXIMIZE, () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.on(IPC.WIN_CLOSE, () => {
    getMainWindow()?.close()
  })

  // -------------------------------------------------------------------------
  // Workspace
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.WORKSPACE_OPEN, async (_e, req: OpenWorkspaceRequest): Promise<WorkspaceSnapshot | undefined> => {
    if (!req.workspaceId) {
      // Sem id, a intencao e "o workspace de agora": reabrir o ativo evita criar
      // um workspace novo a cada boot e encher o manifest de duplicatas.
      const active = store.getActiveWorkspace()
      if (active) return { document: active, isDirty: false }

      // Duas chamadas concorrentes (boot do renderer + reload do HMR) chegariam
      // aqui com `active` ainda vazio e criariam dois workspaces. A promessa
      // compartilhada faz a segunda esperar a primeira.
      creating ??= store
        .createWorkspace(req.name?.trim() || 'Workspace', req.workingDirectory?.trim() || process.cwd())
        .finally(() => {
          creating = undefined
        })
      const doc = await creating
      return { document: doc, isDirty: false }
    }
    const doc = await store.openWorkspace(req.workspaceId)
    if (!doc) return undefined
    return { document: doc, isDirty: false }
  })

  ipcMain.handle(IPC.WORKSPACE_SAVE, async () => {
    store.markDirty()
    await store.flush()
  })

  ipcMain.handle(IPC.WORKSPACE_ADD_NODE, (_e, req: CreateNodeRequest) => {
    const content = nodeContentFor(req)
    if (!content) {
      log.warn(`addNode com tipo desconhecido: ${String(req.type)}`)
      return undefined
    }
    return store.addNode(content, req.frame)
  })

  ipcMain.handle(IPC.WORKSPACE_UPDATE_NODE, (_e, req: UpdateNodeFrameRequest) => {
    store.updateNodeFrame(req.nodeId, req.frame)
  })

  ipcMain.handle(IPC.WORKSPACE_REMOVE_NODE, (_e, nodeId: string) => {
    // Matar o PTY antes de remover o nó: sem isso o processo fica orfao e o
    // agente continua escrevendo num terminal que nao existe mais na tela.
    const node = store.getActivePayload()?.nodes.find((n) => n.id === nodeId)
    if (node?.content.type === 'terminal') {
      const terminalId = node.content.value.id.toUpperCase()
      terminals.destroy(terminalId)
      attached.delete(terminalId)
    }
    store.removeNode(nodeId)
  })

  ipcMain.handle(IPC.WORKSPACE_SET_VIEWPORT, (_e, req: SetViewportRequest) => {
    store.setViewport(req.origin, req.zoom)
  })

  ipcMain.handle(IPC.WORKSPACE_ADD_CONNECTION, (_e, req: { aId: string; bId: string }) => {
    const created = store.addConnection(req.aId, req.bId)
    if (!created) {
      log.warn(`conexao recusada entre ${req.aId} e ${req.bId} (par invalido ou duplicado)`)
    }
    return created
  })

  ipcMain.handle(IPC.WORKSPACE_REMOVE_CONNECTION, (_e, connectionId: string) => {
    store.removeConnection(connectionId)
  })

  // -------------------------------------------------------------------------
  // Terminal
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.TERMINAL_CREATE, async (_e, req: TerminalCreateRequest): Promise<TerminalCreateResult> => {
    const terminalId = req.terminalId.toUpperCase()
    const existing = terminals.get(terminalId)

    if (existing?.isRunning) {
      attachTerminal(existing)
      return {
        terminalId,
        cols: req.cols,
        rows: req.rows,
        initialChunk: existing.snapshot(),
        seq: seqOf(existing),
        running: true,
      }
    }

    try {
      // Duas chamadas concorrentes (StrictMode monta o no duas vezes) precisam
      // compartilhar a mesma promessa: a segunda bateria na trava do manager.
      let pending = creatingTerminals.get(terminalId)
      if (!pending) {
        pending = terminals
          .create({
            id: terminalId,
            name: terminalId,
            agentType: req.agentType as AgentType,
            // Sem repassar `command` o preset vira shell vazio: e esse campo que
            // faz o no abrir o agente (claude, codex, gemini) em vez de um pwsh nu.
            command: req.command,
            shellPath: req.shellPath || undefined,
            workingDirectory: req.workingDirectory || process.cwd(),
            cols: req.cols,
            rows: req.rows,
            // Sem o caminho o scrollback vive so em RAM: ao reiniciar o app o
            // agente perde todo o contexto da conversa anterior.
            scrollbackPath: scrollbackPathFor(terminalId),
          })
          .finally(() => {
            creatingTerminals.delete(terminalId)
          })
        creatingTerminals.set(terminalId, pending)
      }
      const session = await pending
      attachTerminal(session)
      markWorkspaceTerminalRunning(store, terminalId)
      // Sessao nova: o renderer ja esta ouvindo, entao o buffer vem pelo stream
      // e nada precisa ser reenviado aqui (evita duplicar a saida).
      return {
        terminalId,
        cols: req.cols,
        rows: req.rows,
        initialChunk: '',
        seq: 0,
        running: session.isRunning,
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      log.error(`falha ao criar PTY ${terminalId}: ${message}`)
      return {
        terminalId,
        cols: req.cols,
        rows: req.rows,
        initialChunk: '',
        seq: 0,
        running: false,
        error: message,
      }
    }
  })

  ipcMain.handle(IPC.TERMINAL_INPUT, (_e, req: TerminalInputRequest) => {
    terminals.get(req.terminalId)?.write(req.data)
  })

  ipcMain.handle(IPC.TERMINAL_RESIZE, (_e, req: TerminalResizeRequest) => {
    const session = terminals.get(req.terminalId)
    if (!session) return
    // Um PTY com 0 colunas quebra o ConPTY na proxima escrita.
    if (req.cols < 2 || req.rows < 1) return
    session.resize(req.cols, req.rows)
  })

  ipcMain.handle(IPC.TERMINAL_SNAPSHOT, (_e, req: TerminalSnapshotRequest): TerminalSnapshotResult => {
    const session = terminals.get(req.terminalId)
    if (!session) return { terminalId: req.terminalId, text: '', lineCount: 0, running: false }
    const lines = session.bufferLines()
    const slice = req.lines && req.lines > 0 ? lines.slice(-req.lines) : lines
    return {
      terminalId: session.id,
      text: slice.join('\n'),
      lineCount: lines.length,
      running: session.isRunning,
    }
  })

  ipcMain.handle(IPC.TERMINAL_DISPOSE, (_e, terminalId: string) => {
    terminals.destroy(terminalId)
    attached.delete(terminalId.toUpperCase())
  })

  ipcMain.handle(IPC.TERMINAL_SET_ACTIVE, (_e, terminalId: string) => {
    // Atividade manual do usuario: impede o `ask` de injetar prompt no meio
    // de algo que a pessoa esta digitando.
    terminals.get(terminalId)?.markActiveTask()
  })

  // -------------------------------------------------------------------------
  // Notas e file tree
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.NOTE_READ, async (_e, req: NoteReadRequest): Promise<string> => {
    const workspaceId = store.getActivePayload()?.id
    if (!workspaceId) return ''
    return store.readNote(workspaceId, req.fileName)
  })

  ipcMain.handle(IPC.NOTE_WRITE, async (_e, req: NoteWriteRequest) => {
    const workspaceId = store.getActivePayload()?.id
    if (!workspaceId) return
    // `sanitizeFileName` no caminho final: um nome vindo do renderer nao pode
    // escapar de `notes/` com `..`. `false` = nao reemitir para o renderer:
    // quem gravou foi o proprio editor e recarregar o texto mataria o cursor.
    await store.writeNote(workspaceId, sanitizeFileName(req.fileName), req.content, false)
  })

  ipcMain.handle(IPC.FILETREE_LIST, (_e, req: FileTreeListRequest) => {
    return listDirectory(req.rootPath, req.relativePath ?? '')
  })

  /**
   * Observa o diretorio do nó e avisa o renderer. Sem isso o file tree fica
   * congelado no instante em que o nó montou — o agente cria arquivo e a
   * pessoa continua vendo a pasta vazia.
   */
  ipcMain.handle(
    IPC.FILETREE_WATCH,
    async (_e, req: FileTreeListRequest): Promise<boolean> => {
      const rootPath = req.rootPath
      // Chamar watch de novo para o mesmo no e idempotente no DirectoryWatcher;
      // o debounce de 150ms evita enxurrada de eventos num `npm install`.
      await watchDirectory(rootPath, req.relativePath ?? '', () => {
        broadcast(IPC.FILETREE_CHANGED, { rootPath, relativePath: req.relativePath ?? '' })
      })
      return true
    },
  )

  ipcMain.handle(IPC.FILETREE_UNWATCH, async (_e, rootPath: string) => {
    await unwatchDirectory(rootPath)
  })
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

/**
 * Liga os eventos da sessao ao renderer uma unica vez por PTY. Duas inscricoes
 * fariam cada caractere chegar duas vezes ao xterm.
 */
function attachTerminal(session: TerminalSession): void {
  if (attached.has(session.id)) return
  attached.add(session.id)

  session.onData((data) => {
    broadcast(IPC.TERMINAL_DATA, { terminalId: session.id, data, seq: nextSeq(session.id) })
  })

  session.onExit(({ exitCode, signal }) => {
    attached.delete(session.id)
    broadcast(IPC.TERMINAL_EXIT, { terminalId: session.id, exitCode, signal })
  })
}

const sequence = new Map<string, number>()

function nextSeq(terminalId: string): number {
  const value = (sequence.get(terminalId) ?? 0) + 1
  sequence.set(terminalId, value)
  return value
}

function seqOf(session: TerminalSession): number {
  return sequence.get(session.id) ?? 0
}

function markWorkspaceTerminalRunning(store: WorkspaceStore, terminalId: string): void {
  const node = store.getActivePayload()?.nodes.find(
    (n) => n.content.type === 'terminal' && n.content.value.id.toUpperCase() === terminalId,
  )
  if (node?.content.type !== 'terminal') return
  node.content.value.status = 'running'
  node.content.value.lastActiveAt = new Date()
  store.markDirty()
}

function nodeContentFor(req: CreateNodeRequest): NodeContent | undefined {
  const value = (req.value ?? {}) as Record<string, unknown>
  switch (req.type) {
    case 'terminal': {
      const terminal = createTerminalContent(
        typeof value.name === 'string' ? value.name : 'Terminal',
        typeof value.workingDirectory === 'string' ? value.workingDirectory : process.cwd(),
        {
          ...(value as Partial<Parameters<typeof createTerminalContent>[2]>),
          id: typeof value.id === 'string' && value.id ? value.id.toUpperCase() : newId(),
        },
      )
      return { type: 'terminal', value: terminal }
    }
    case 'stickyNote':
      return {
        type: 'stickyNote',
        value: createStickyNoteContent(
          typeof value.fileName === 'string' ? value.fileName.replace(/\.md$/, '') : `Nota ${newId().slice(0, 4)}`,
          value as Partial<ReturnType<typeof createStickyNoteContent>>,
        ),
      }
    case 'text':
      return { type: 'text', value: createTextContent(typeof value.text === 'string' ? value.text : '') }
    case 'portal':
      return {
        type: 'portal',
        value: createPortalContent(
          typeof value.name === 'string' ? value.name : 'Portal',
          typeof value.currentURL === 'string' ? value.currentURL : '',
        ),
      }
    case 'fileTree':
      return {
        type: 'fileTree',
        value: createFileTreeContent(
          typeof value.name === 'string' ? value.name : 'Arquivos',
          typeof value.rootPath === 'string' ? value.rootPath : process.cwd(),
        ),
      }
    default:
      return undefined
  }
}

/** Envia um evento a todas as janelas abertas. */
export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}
