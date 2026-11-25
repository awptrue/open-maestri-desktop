/**
 * Preload — ponte tipada entre renderer e main via contextBridge.
 *
 * Regras:
 *  - `ipcRenderer` nunca e exposto cru.
 *  - Todo canal declarado aqui existe em `@shared/ipc-channels`.
 *  - O renderer nunca escreve JSON: ele envia intencao, o main persiste.
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

import { IPC } from '../shared/ipc-channels'
import type {
  AddConnectionRequest,
  CreateNodeRequest,
  FileTreeChangedEvent,
  FileTreeListRequest,
  FileTreeListResult,
  MaestriBridgeApi,
  NoteReadRequest,
  NoteChangedEvent,
  NoteWriteRequest,
  OpenWorkspaceRequest,
  SetViewportRequest,
  TerminalCreateRequest,
  TerminalCreateResult,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalInputRequest,
  TerminalResizeRequest,
  TerminalSnapshotRequest,
  TerminalSnapshotResult,
  UpdateNodeFrameRequest,
  WorkspaceChangedEvent,
  WorkspaceSnapshot,
} from '../shared/ipc-contract'
import type { CanvasNode } from '../shared/models/workspace'

/** Assinatura tipada para eventos enviados pelo main. */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

const api: MaestriBridgeApi = {
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.APP_GET_VERSION),
    getPlatform: (): string => process.platform,
  },

  window: {
    minimize: (): void => ipcRenderer.send(IPC.WIN_MINIMIZE),
    maximize: (): void => ipcRenderer.send(IPC.WIN_MAXIMIZE),
    close: (): void => ipcRenderer.send(IPC.WIN_CLOSE),
  },

  workspace: {
    /** Abre um workspace existente ou cria um novo quando `workspaceId` falta. */
    open: (req: OpenWorkspaceRequest): Promise<WorkspaceSnapshot | undefined> =>
      ipcRenderer.invoke(IPC.WORKSPACE_OPEN, req),
    save: (): Promise<void> => ipcRenderer.invoke(IPC.WORKSPACE_SAVE),
    addNode: (req: CreateNodeRequest): Promise<CanvasNode | undefined> =>
      ipcRenderer.invoke(IPC.WORKSPACE_ADD_NODE, req),
    updateNodeFrame: (req: UpdateNodeFrameRequest): Promise<void> =>
      ipcRenderer.invoke(IPC.WORKSPACE_UPDATE_NODE, req),
    removeNode: (nodeId: string): Promise<void> => ipcRenderer.invoke(IPC.WORKSPACE_REMOVE_NODE, nodeId),
    setViewport: (req: SetViewportRequest): Promise<void> =>
      ipcRenderer.invoke(IPC.WORKSPACE_SET_VIEWPORT, req),
    addConnection: (req: AddConnectionRequest): Promise<boolean> =>
      ipcRenderer.invoke(IPC.WORKSPACE_ADD_CONNECTION, req),
    removeConnection: (connectionId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.WORKSPACE_REMOVE_CONNECTION, connectionId),
    onChanged: (listener: (event: WorkspaceChangedEvent) => void): (() => void) =>
      subscribe<WorkspaceChangedEvent>(IPC.WORKSPACE_CHANGED, listener),
  },

  terminal: {
    /**
     * Cria (ou reata) o PTY de um nó terminal. Idempotente por `terminalId`:
     * chamar duas vezes devolve o mesmo processo, nunca um segundo shell.
     */
    create: (req: TerminalCreateRequest): Promise<TerminalCreateResult> =>
      ipcRenderer.invoke(IPC.TERMINAL_CREATE, req),
    input: (req: TerminalInputRequest): Promise<void> => ipcRenderer.invoke(IPC.TERMINAL_INPUT, req),
    resize: (req: TerminalResizeRequest): Promise<void> =>
      ipcRenderer.invoke(IPC.TERMINAL_RESIZE, req),
    snapshot: (req: TerminalSnapshotRequest): Promise<TerminalSnapshotResult> =>
      ipcRenderer.invoke(IPC.TERMINAL_SNAPSHOT, req),
    dispose: (terminalId: string): Promise<void> => ipcRenderer.invoke(IPC.TERMINAL_DISPOSE, terminalId),
    /** Marca atividade manual do usuario, para o `ask` nao disparar no meio dela. */
    setActive: (terminalId: string): Promise<void> => ipcRenderer.invoke(IPC.TERMINAL_SET_ACTIVE, terminalId),
    onData: (listener: (event: TerminalDataEvent) => void): (() => void) =>
      subscribe<TerminalDataEvent>(IPC.TERMINAL_DATA, listener),
    onExit: (listener: (event: TerminalExitEvent) => void): (() => void) =>
      subscribe<TerminalExitEvent>(IPC.TERMINAL_EXIT, listener),
  },

  note: {
    read: (req: NoteReadRequest): Promise<string> => ipcRenderer.invoke(IPC.NOTE_READ, req),
    write: (req: NoteWriteRequest): Promise<void> => ipcRenderer.invoke(IPC.NOTE_WRITE, req),
    onChanged: (listener: (event: NoteChangedEvent) => void): (() => void) =>
      subscribe<NoteChangedEvent>(IPC.NOTE_CHANGED, listener),
  },

  fileTree: {
    list: (req: FileTreeListRequest): Promise<FileTreeListResult> =>
      ipcRenderer.invoke(IPC.FILETREE_LIST, req),
    watch: (req: FileTreeListRequest): Promise<boolean> => ipcRenderer.invoke(IPC.FILETREE_WATCH, req),
    unwatch: (rootPath: string): Promise<void> => ipcRenderer.invoke(IPC.FILETREE_UNWATCH, rootPath),
    onChanged: (listener: (event: FileTreeChangedEvent) => void): (() => void) =>
      subscribe<FileTreeChangedEvent>(IPC.FILETREE_CHANGED, listener),
  },
} satisfies MaestriBridgeApi

export type MaestriApi = MaestriBridgeApi

contextBridge.exposeInMainWorld('maestri', api)
