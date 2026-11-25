/**
 * Canais IPC. Nomes em `dominio:acao`.
 *
 * Regra: o renderer nunca escreve JSON; ele envia intencao e o main persiste.
 */

export const IPC = {
  // app
  APP_GET_VERSION: 'app:get-version',
  APP_GET_PLATFORM: 'app:get-platform',

  // janela
  WIN_MINIMIZE: 'win:minimize',
  WIN_MAXIMIZE: 'win:maximize',
  WIN_CLOSE: 'win:close',

  // estado do app / manifest
  STATE_LOAD: 'state:load',
  STATE_SAVE_APP_STATE: 'state:save-app-state',

  // workspace
  WORKSPACE_OPEN: 'workspace:open',
  WORKSPACE_CREATE: 'workspace:create',
  WORKSPACE_CLOSE: 'workspace:close',
  WORKSPACE_LIST: 'workspace:list',
  WORKSPACE_SAVE: 'workspace:save',
  WORKSPACE_ADD_NODE: 'workspace:add-node',
  WORKSPACE_UPDATE_NODE: 'workspace:update-node',
  WORKSPACE_REMOVE_NODE: 'workspace:remove-node',
  WORKSPACE_ADD_CONNECTION: 'workspace:add-connection',
  WORKSPACE_REMOVE_CONNECTION: 'workspace:remove-connection',
  WORKSPACE_SET_VIEWPORT: 'workspace:set-viewport',
  WORKSPACE_CHANGED: 'workspace:changed',

  // terminal
  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_DISPOSE: 'terminal:dispose',
  TERMINAL_INPUT: 'terminal:input',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_EXIT: 'terminal:exit',
  TERMINAL_SNAPSHOT: 'terminal:snapshot',
  TERMINAL_SET_ACTIVE: 'terminal:set-active',

  // nota
  NOTE_READ: 'note:read',
  NOTE_WRITE: 'note:write',
  /** Nota alterada por FORA do editor: o CLI `omaestri note write`. */
  NOTE_CHANGED: 'note:changed',

  // file tree
  FILETREE_LIST: 'filetree:list',
  FILETREE_WATCH: 'filetree:watch',
  FILETREE_UNWATCH: 'filetree:unwatch',
  FILETREE_CHANGED: 'filetree:changed',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
