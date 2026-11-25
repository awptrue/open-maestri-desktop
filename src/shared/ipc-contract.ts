/**
 * Contrato tipado do IPC entre renderer, preload e main.
 *
 * Os nomes de canal ficam em `ipc-channels.ts`; aqui vivem apenas as formas de
 * request/response, para que os dois lados negociem tipos sem importar codigo
 * do processo main.
 *
 * Regra de identidade do terminal: a chave de uma sessao PTY e
 * `TerminalContent.id` (nao o id do no). `TerminalConnection.terminalIdA/B`
 * apontam para esse mesmo id no formato do macOS.
 */

import type { Frame } from './models/geometry'
import type {
  AgentType,
  PortalContent,
  StickyNoteContent,
  TextContent,
} from './models/node-content'
import type { CanvasNode, WorkspaceDocument } from './models/workspace'

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export interface WorkspaceSnapshot {
  document: WorkspaceDocument
  isDirty: boolean
}

export interface OpenWorkspaceRequest {
  workspaceId?: string
  /** Cria um workspace novo quando nenhum id e informado. */
  name?: string
  workingDirectory?: string
}

export interface CreateNodeRequest {
  type: 'terminal' | 'stickyNote' | 'text' | 'portal' | 'fileTree'
  frame: Frame
  /** Payload do conteudo. O main aplica os defaults do tipo. */
  value?: Partial<
    TerminalCreateInput | StickyNoteContent | TextContent | PortalContent | { name: string; rootPath: string }
  >
}

export interface TerminalCreateInput {
  agentType: AgentType
  command: string
  name: string
  icon: string
  color: string
  workingDirectory: string
  shellPath?: string
}

export interface UpdateNodeFrameRequest {
  nodeId: string
  frame: Frame
}

export interface SetViewportRequest {
  origin: { x: number; y: number }
  zoom: number
}

/** Dois nos a conectar. O main decide o tipo de conexao pelo conteudo. */
export interface AddConnectionRequest {
  aId: string
  bId: string
}

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

export interface TerminalCreateRequest {
  /** Igual a `TerminalContent.id`. */
  terminalId: string
  agentType: AgentType
  command: string
  workingDirectory: string
  shellPath?: string
  cols: number
  rows: number
}

export interface TerminalCreateResult {
  terminalId: string
  cols: number
  rows: number
  /**
   * Buffer acumulado ate agora (texto ja renderizado pelo headless do main).
   * Vazio quando a sessao acabou de nascer.
   */
  initialChunk: string
  /**
   * Ultimo numero de sequencia ja incluido em `initialChunk`. O renderer
   * descarta eventos com `seq <= this` — evita duplicar a saida que chegou
   * entre a criacao e a inscricao no stream.
   */
  seq: number
  /** false quando o PTY nao subiu; o no mostra o erro em vez de fingir terminal. */
  running: boolean
  error?: string
}

export interface TerminalScopeRequest {
  terminalId: string
}

export interface TerminalInputRequest {
  terminalId: string
  data: string
}

export interface TerminalResizeRequest {
  terminalId: string
  cols: number
  rows: number
}

export interface TerminalSnapshotRequest {
  terminalId: string
  /** Numero de linhas do fim do buffer. Sem valor devolve o buffer inteiro. */
  lines?: number
}

export interface TerminalSnapshotResult {
  terminalId: string
  text: string
  lineCount: number
  running: boolean
}

/** Evento main -> renderer: saida do processo. */
export interface TerminalDataEvent {
  terminalId: string
  data: string
  /** Contador monotonico por sessao; usado para acertar a emenda com o snapshot. */
  seq: number
}

/** Evento main -> renderer: processo terminou. */
export interface TerminalExitEvent {
  terminalId: string
  exitCode: number
  signal?: number
}

// ---------------------------------------------------------------------------
// Notas e file tree
// ---------------------------------------------------------------------------

export interface NoteReadRequest {
  fileName: string
}

export interface NoteWriteRequest {
  fileName: string
  content: string
}

/**
 * Evento main -> renderer: a nota foi gravada por FORA do editor. Hoje o unico
 * produtor e o CLI `omaestri note write`. O proprio editor nao recebe este
 * evento, para o texto nao ser recarregado com o cursor no meio da digitacao.
 */
export interface NoteChangedEvent {
  fileName: string
}

export interface FileTreeEntry {
  name: string
  path: string
  isDirectory: boolean
}

export interface FileTreeListRequest {
  rootPath: string
  /** Caminho relativo a `rootPath`; vazio = raiz. */
  relativePath?: string
}

export interface FileTreeListResult {
  relativePath: string
  entries: FileTreeEntry[]
  error?: string
}

/** Evento main -> renderer: algo mudou dentro da pasta observada. */
export interface FileTreeChangedEvent {
  rootPath: string
  relativePath: string
}

/** Evento main -> renderer: workspace mudou (autosave, CLI, outro view). */
export interface WorkspaceChangedEvent {
  document: WorkspaceDocument
}

// ---------------------------------------------------------------------------
// Superficie exposta pelo preload
// ---------------------------------------------------------------------------

/**
 * Forma de `window.maestri`. Vive no shared (e nao no preload) para que o
 * renderer tipar a propria ponte sem importar codigo do processo Electron —
 * o `tsconfig.web` nao compila `src/preload`.
 */
export interface MaestriBridgeApi {
  app: {
    getVersion(): Promise<string>
    getPlatform(): string
  }
  window: {
    minimize(): void
    maximize(): void
    close(): void
  }
  workspace: {
    open(req: OpenWorkspaceRequest): Promise<WorkspaceSnapshot | undefined>
    save(): Promise<void>
    addNode(req: CreateNodeRequest): Promise<CanvasNode | undefined>
    updateNodeFrame(req: UpdateNodeFrameRequest): Promise<void>
    removeNode(nodeId: string): Promise<void>
    setViewport(req: SetViewportRequest): Promise<void>
    addConnection(req: AddConnectionRequest): Promise<boolean>
    removeConnection(connectionId: string): Promise<void>
    onChanged(listener: (event: WorkspaceChangedEvent) => void): () => void
  }
  terminal: {
    create(req: TerminalCreateRequest): Promise<TerminalCreateResult>
    input(req: TerminalInputRequest): Promise<void>
    resize(req: TerminalResizeRequest): Promise<void>
    snapshot(req: TerminalSnapshotRequest): Promise<TerminalSnapshotResult>
    dispose(terminalId: string): Promise<void>
    setActive(terminalId: string): Promise<void>
    onData(listener: (event: TerminalDataEvent) => void): () => void
    onExit(listener: (event: TerminalExitEvent) => void): () => void
  }
  note: {
    read(req: NoteReadRequest): Promise<string>
    write(req: NoteWriteRequest): Promise<void>
    /** Nota gravada por fora do editor (CLI). */
    onChanged(listener: (event: NoteChangedEvent) => void): () => void
  }
  fileTree: {
    list(req: FileTreeListRequest): Promise<FileTreeListResult>
    /** Passa a observar a pasta; eventos chegam em `onChanged`. */
    watch(req: FileTreeListRequest): Promise<boolean>
    unwatch(rootPath: string): Promise<void>
    onChanged(listener: (event: FileTreeChangedEvent) => void): () => void
  }
}

export type { CanvasNode }
