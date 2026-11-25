/**
 * Acesso tipado a bridge do preload.
 *
 * `window.maestri` so existe quando a pagina roda dentro do Electron. No
 * `vitest`/jsdom e ao abrir o HTML no navegador ele nao existe — nesse caso as
 * chamadas devolvem valores neutros em vez de estourar `TypeError` no meio da
 * arvore React.
 */

import type { MaestriBridgeApi } from '@shared/ipc-contract'

function bridge(): MaestriBridgeApi | undefined {
  return typeof window === 'undefined' ? undefined : window.maestri
}

/** true quando o renderer esta dentro do Electron com o preload carregado. */
export function hasBridge(): boolean {
  return bridge() !== undefined
}

const NOT_AVAILABLE = 'bridge indisponivel (fora do Electron)'

export const api: MaestriBridgeApi = {
  app: {
    getVersion: () => bridge()?.app.getVersion() ?? Promise.resolve('0.0.0'),
    getPlatform: () => bridge()?.app.getPlatform() ?? 'web',
  },
  window: {
    minimize: () => bridge()?.window.minimize(),
    maximize: () => bridge()?.window.maximize(),
    close: () => bridge()?.window.close(),
  },
  workspace: {
    open: (req) => bridge()?.workspace.open(req) ?? Promise.resolve(undefined),
    save: () => bridge()?.workspace.save() ?? Promise.resolve(),
    addNode: (req) => bridge()?.workspace.addNode(req) ?? Promise.resolve(undefined),
    updateNodeFrame: (req) => bridge()?.workspace.updateNodeFrame(req) ?? Promise.resolve(),
    removeNode: (nodeId) => bridge()?.workspace.removeNode(nodeId) ?? Promise.resolve(),
    setViewport: (req) => bridge()?.workspace.setViewport(req) ?? Promise.resolve(),
    addConnection: (req) => bridge()?.workspace.addConnection(req) ?? Promise.resolve(false),
    removeConnection: (connectionId) => bridge()?.workspace.removeConnection(connectionId) ?? Promise.resolve(),
    onChanged: (listener) => bridge()?.workspace.onChanged(listener) ?? (() => undefined),
  },
  terminal: {
    create: (req) =>
      bridge()?.terminal.create(req) ??
      Promise.resolve({
        terminalId: req.terminalId,
        cols: req.cols,
        rows: req.rows,
        initialChunk: '',
        seq: 0,
        running: false,
        error: NOT_AVAILABLE,
      }),
    input: (req) => bridge()?.terminal.input(req) ?? Promise.resolve(),
    resize: (req) => bridge()?.terminal.resize(req) ?? Promise.resolve(),
    snapshot: (req) =>
      bridge()?.terminal.snapshot(req) ??
      Promise.resolve({ terminalId: req.terminalId, text: '', lineCount: 0, running: false }),
    dispose: (terminalId) => bridge()?.terminal.dispose(terminalId) ?? Promise.resolve(),
    setActive: (terminalId) => bridge()?.terminal.setActive(terminalId) ?? Promise.resolve(),
    onData: (listener) => bridge()?.terminal.onData(listener) ?? (() => undefined),
    onExit: (listener) => bridge()?.terminal.onExit(listener) ?? (() => undefined),
  },
  note: {
    read: (req) => bridge()?.note.read(req) ?? Promise.resolve(''),
    write: (req) => bridge()?.note.write(req) ?? Promise.resolve(),
    onChanged: (listener) => bridge()?.note.onChanged(listener) ?? (() => undefined),
  },
  fileTree: {
    list: (req) =>
      bridge()?.fileTree.list(req) ??
      Promise.resolve({ relativePath: req.relativePath ?? '', entries: [], error: NOT_AVAILABLE }),
    watch: (req) => bridge()?.fileTree.watch(req) ?? Promise.resolve(false),
    unwatch: (rootPath) => bridge()?.fileTree.unwatch(rootPath) ?? Promise.resolve(),
    onChanged: (listener) => bridge()?.fileTree.onChanged(listener) ?? (() => undefined),
  },
}
