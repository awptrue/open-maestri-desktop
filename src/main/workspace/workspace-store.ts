/**
 * Store do workspace — autoridade do estado no processo main.
 *
 * O renderer mantem uma copia para desenhar a 60 fps; aqui vive o estado
 * canonico que vai para o disco. Toda mutacao passa por um metodo desta classe,
 * que marca `isDirty` e deixa o autosave gravar.
 */

import {
  createCanvasNode,
  createWorkspaceDocument,
  createWorkspacePayload,
  decodeWorkspaceDocument,
  encodeWorkspaceDocument,
  type CanvasNode,
  type WorkspaceDocument,
  type WorkspacePayload,
} from '@shared/models/workspace'
import { newId } from '@shared/models/codec'
import { frameCenter, type Frame } from '@shared/models/geometry'
import type { NodeContent } from '@shared/models/node-content'
import {
  defaultAppState,
  type AppStateData,
  type WorkspaceEntry,
  type WorkspaceManifest,
} from '@shared/models/persistence'

import { createLogger } from '../logger'
import type { PersistenceManager } from '../persistence/persistence-manager'
import type { TerminalManager } from '../terminal/terminal-manager'

const log = createLogger('WorkspaceStore')

/** Duas conexoes sao a mesma quando ligam o mesmo par, em qualquer ordem. */
function samePair(a1: string, b1: string, a2: string, b2: string): boolean {
  return (a1 === a2 && b1 === b2) || (a1 === b2 && b1 === a2)
}

export interface LoadedWorkspace {
  document: WorkspaceDocument
  isDirty: boolean
}

export class WorkspaceStore {
  private manifest: WorkspaceManifest
  private appState: AppStateData
  private active: LoadedWorkspace | undefined
  private autosaveTimer: NodeJS.Timeout | undefined
  private saving = false
  private readonly noteListeners = new Set<(workspaceId: string, fileName: string) => void>()
  /** Resultado do run anterior, lido do disco em `load()`. */
  private hadUncleanShutdown = false

  constructor(
    private readonly persistence: PersistenceManager,
    private readonly terminals: TerminalManager,
    private readonly autosaveIntervalMs: number,
  ) {
    this.manifest = { schemaVersion: 1, type: 'appState', app: 'open-maestri', appVersion: '1.0.0', dataFormat: 2, workspaces: [], files: {} }
    this.appState = defaultAppState()
  }

  // -------------------------------------------------------------------------
  // Ciclo de vida
  // -------------------------------------------------------------------------

  async load(): Promise<void> {
    await this.persistence.ensureRootDirs()
    const [manifest, appState] = await Promise.all([
      this.persistence.loadManifest(),
      this.persistence.loadAppState(),
    ])
    this.manifest = manifest
    this.appState = appState
    log.info(`manifest: ${manifest.workspaces.length} workspace(s)`)

    // O valor LIDO do disco e que diz se o run anterior terminou limpo. Sem
    // guarda-lo antes do reset, `needsRecovery` seria sempre true e o aviso de
    // crash viraria ruido permanente em todo boot.
    this.hadUncleanShutdown = !appState.cleanShutdown

    // Marca shutdown sujo: se o processo morrer agora, o proximo boot detecta.
    this.appState.cleanShutdown = false
    await this.persistence.saveAppState(this.appState)

    if (appState.activeWorkspaceId) {
      await this.openWorkspace(appState.activeWorkspaceId).catch((e: unknown) => {
        log.warn(`workspace ativo ${appState.activeWorkspaceId} nao abriu: ${String(e)}`)
      })
    }

    this.startAutosave()
  }

  get needsRecovery(): boolean {
    return this.hadUncleanShutdown
  }

  getManifest(): WorkspaceManifest {
    return this.manifest
  }

  getActiveWorkspace(): WorkspaceDocument | undefined {
    return this.active?.document
  }

  getActivePayload(): WorkspacePayload | undefined {
    return this.active?.document.payload
  }

  // -------------------------------------------------------------------------
  // Workspace
  // -------------------------------------------------------------------------

  async createWorkspace(name: string, workingDirectory: string, color = 'blue'): Promise<WorkspaceDocument> {
    const id = newId()
    const payload = createWorkspacePayload(id, name, workingDirectory)
    const doc = createWorkspaceDocument(payload)

    const entry: WorkspaceEntry = {
      id,
      name,
      workingDirectory,
      icon: 'folder',
      color,
      isPinned: false,
      locationType: 'local',
      createdAt: payload.createdAt,
    }
    this.manifest.workspaces.unshift(entry)

    await this.persistence.ensureWorkspaceDirs(id)
    await Promise.all([this.persistence.saveWorkspace(doc), this.persistence.saveManifest(this.manifest)])
    await this.setActive(id, doc)
    log.info(`workspace criado: ${name} (${id})`)
    return doc
  }

  async openWorkspace(id: string): Promise<WorkspaceDocument | undefined> {
    if (this.active?.document.payload.id === id.toUpperCase()) return this.active.document
    const loaded = await this.persistence.loadWorkspace(id)
    if (!loaded) {
      log.warn(`workspace ${id} nao encontrado em disco`)
      return undefined
    }
    await this.setActive(id, loaded)
    return loaded
  }

  private async setActive(id: string, doc: WorkspaceDocument): Promise<void> {
    await this.flush()
    this.active = { document: doc, isDirty: false }

    this.appState.activeWorkspaceId = id.toUpperCase()
    this.appState.lastOpenedAt = new Date()
    this.appState.recentWorkspaceIds = [
      id.toUpperCase(),
      ...this.appState.recentWorkspaceIds.filter((w) => w !== id.toUpperCase()),
    ].slice(0, 5)

    const entry = this.manifest.workspaces.find((w) => w.id === id.toUpperCase())
    if (entry) entry.lastOpenedAt = new Date()

    await Promise.all([this.persistence.saveAppState(this.appState), this.persistence.saveManifest(this.manifest)])
  }

  async deleteWorkspace(id: string): Promise<void> {
    const upper = id.toUpperCase()
    // Nao pode sobrar processo orfao: PTY vivo sem nó no canvas e vazamento.
    for (const session of this.terminals.all()) {
      this.terminals.destroy(session.id)
    }
    await this.persistence.deleteWorkspace(upper)
    this.manifest.workspaces = this.manifest.workspaces.filter((w) => w.id !== upper)
    this.appState.recentWorkspaceIds = this.appState.recentWorkspaceIds.filter((w) => w !== upper)
    if (this.appState.activeWorkspaceId === upper) this.appState.activeWorkspaceId = undefined
    if (this.active?.document.payload.id === upper) this.active = undefined
    await Promise.all([this.persistence.saveManifest(this.manifest), this.persistence.saveAppState(this.appState)])
    log.info(`workspace removido: ${upper}`)
  }

  // -------------------------------------------------------------------------
  // Nos
  // -------------------------------------------------------------------------

  addNode(content: NodeContent, frame: Frame, zIndex?: number): CanvasNode | undefined {
    const payload = this.active?.document.payload
    if (!payload) return undefined
    const nextZ = zIndex ?? Math.max(0, ...payload.nodes.map((n) => n.zIndex)) + 1
    const node = createCanvasNode(newId(), frame, content, nextZ)
    payload.nodes.push(node)
    this.markDirty()
    return node
  }

  updateNodeFrame(id: string, frame: Frame): void {
    const node = this.active?.document.payload.nodes.find((n) => n.id === id)
    if (!node) return
    node.frame = frame
    node.lastModifiedAt = new Date()
    this.markDirty()
  }

  updateNodeLock(id: string, isLocked: boolean): void {
    const node = this.active?.document.payload.nodes.find((n) => n.id === id)
    if (!node) return
    node.isLocked = isLocked
    node.lastModifiedAt = new Date()
    this.markDirty()
  }

  removeNode(id: string): void {
    const payload = this.active?.document.payload
    if (!payload) return
    const node = payload.nodes.find((n) => n.id === id)
    if (!node) return

    payload.nodes = payload.nodes.filter((n) => n.id !== id)
    // Conexao sem ponta e corrupcao: some junto com o nó.
    payload.connections = payload.connections.filter((c) => c.terminalIdA !== id && c.terminalIdB !== id)
    payload.noteConnections = payload.noteConnections.filter((c) => c.terminalId !== id && c.noteNodeId !== id)
    payload.portalConnections = payload.portalConnections.filter((c) => c.terminalId !== id && c.portalNodeId !== id)
    payload.portalToPortalConnections = payload.portalToPortalConnections.filter(
      (c) => c.portalIdA !== id && c.portalIdB !== id,
    )
    payload.noteToNoteConnections = payload.noteToNoteConnections.filter(
      (c) => c.noteNodeIdA !== id && c.noteNodeIdB !== id,
    )
    this.markDirty()
  }

  // -------------------------------------------------------------------------
  // Viewport
  // -------------------------------------------------------------------------

  setViewport(origin: { x: number; y: number }, zoom: number): void {
    const payload = this.active?.document.payload
    if (!payload) return
    payload.canvasOrigin = origin
    payload.canvasZoom = zoom
    this.markDirty()
  }

  // -------------------------------------------------------------------------
  // Conexoes
  // -------------------------------------------------------------------------

  /**
   * Cria a conexao entre dois nos, escolhendo o tipo certo pelo conteudo:
   * terminal-terminal, terminal-nota, terminal-portal. Dois nos que nao formam
   * par valido (nota com textual, portal com portal) ficam de fora da v1.
   */
  addConnection(aId: string, bId: string): boolean {
    const payload = this.active?.document.payload
    if (!payload) return false
    if (aId === bId) return false

    const a = payload.nodes.find((n) => n.id === aId)
    const b = payload.nodes.find((n) => n.id === bId)
    if (!a || !b) return false

    const terminalOf = (node: CanvasNode): string | undefined =>
      node.content.type === 'terminal' ? node.content.value.id : undefined

    // Ordem normalizada: as conexoes do macOS guardam ids estaveis em A/B.
    const aTerminal = terminalOf(a)
    const bTerminal = terminalOf(b)

    if (aTerminal && bTerminal) {
      if (payload.connections.some((c) => samePair(c.terminalIdA, c.terminalIdB, aTerminal, bTerminal))) {
        return false
      }
      payload.connections.push({
        id: newId(),
        createdAt: new Date(),
        terminalIdA: aTerminal,
        terminalIdB: bTerminal,
        ropePoints: [],
      })
      this.markDirty()
      return true
    }

    const terminal = aTerminal ?? bTerminal
    const other = aTerminal ? b : a
    if (!terminal) return false

    if (other.content.type === 'stickyNote') {
      if (payload.noteConnections.some((c) => c.terminalId === terminal && c.noteNodeId === other.id)) {
        return false
      }
      payload.noteConnections.push({
        id: newId(),
        createdAt: new Date(),
        terminalId: terminal,
        noteNodeId: other.id,
        ropePoints: [],
      })
      this.markDirty()
      return true
    }

    if (other.content.type === 'portal') {
      if (payload.portalConnections.some((c) => c.terminalId === terminal && c.portalNodeId === other.id)) {
        return false
      }
      payload.portalConnections.push({
        id: newId(),
        createdAt: new Date(),
        terminalId: terminal,
        portalNodeId: other.id,
        ropePoints: [],
      })
      this.markDirty()
      return true
    }

    return false
  }

  removeConnection(id: string): void {
    const payload = this.active?.document.payload
    if (!payload) return
    const before =
      payload.connections.length +
      payload.noteConnections.length +
      payload.portalConnections.length +
      payload.portalToPortalConnections.length +
      payload.noteToNoteConnections.length

    payload.connections = payload.connections.filter((c) => c.id !== id)
    payload.noteConnections = payload.noteConnections.filter((c) => c.id !== id)
    payload.portalConnections = payload.portalConnections.filter((c) => c.id !== id)
    payload.portalToPortalConnections = payload.portalToPortalConnections.filter((c) => c.id !== id)
    payload.noteToNoteConnections = payload.noteToNoteConnections.filter((c) => c.id !== id)

    const after =
      payload.connections.length +
      payload.noteConnections.length +
      payload.portalConnections.length +
      payload.portalToPortalConnections.length +
      payload.noteToNoteConnections.length

    // Nao marcar dirty quando nada mudou: um Delete perdido nao pode disparar
    // gravacao nem sujar o workspace.
    if (after !== before) this.markDirty()
  }

  // -------------------------------------------------------------------------
  // Notas
  // -------------------------------------------------------------------------

  /**
   * Le a nota do workspace ativo. A nota vive em `notes/` do diretorio do
   * workspace; o `workspace.json` guarda so a referencia (`fileName`).
   */
  async readNote(workspaceId: string, fileName: string): Promise<string> {
    return this.persistence.readNote(workspaceId.toUpperCase(), fileName)
  }

  /**
   * Grava a nota e, quando a escrita veio de fora do editor (`omaestri note
   * write`), avisa o renderer. Sem esse aviso a nota aberta continua mostrando
   * o texto antigo enquanto o arquivo em disco ja mudou.
   *
   * `notify = false` no caminho do proprio editor: recarregar o texto enquanto
   * a pessoa digita faria o cursor pular.
   */
  async writeNote(
    workspaceId: string,
    fileName: string,
    content: string,
    notify = true,
  ): Promise<void> {
    await this.persistence.writeNote(workspaceId.toUpperCase(), fileName, content)
    if (!notify) return
    for (const listener of this.noteListeners) {
      try {
        listener(workspaceId.toUpperCase(), fileName)
      } catch (e) {
        // Um listener quebrado nao pode desfazer a gravacao ja concluida.
        log.warn(`listener de nota falhou: ${String(e)}`)
      }
    }
  }

  /**
   * Registra um ouvinte de nota gravada por fora. Devolve a funcao de remocao.
   */
  onNoteWritten(listener: (workspaceId: string, fileName: string) => void): () => void {
    this.noteListeners.add(listener)
    return () => {
      this.noteListeners.delete(listener)
    }
  }

  // -------------------------------------------------------------------------
  // Autosave
  // -------------------------------------------------------------------------

  markDirty(): void {
    if (this.active) this.active.isDirty = true
  }

  private startAutosave(): void {
    if (this.autosaveTimer) clearInterval(this.autosaveTimer)
    this.autosaveTimer = setInterval(() => {
      void this.flush()
    }, this.autosaveIntervalMs)
    this.autosaveTimer.unref?.()
  }

  /** Grava se houver alteracao. Serializado: duas gravacoes nao se atropelam. */
  async flush(): Promise<void> {
    if (this.saving) return
    const active = this.active
    if (!active?.isDirty) return

    this.saving = true
    // Snapshot antes do await: a gravacao nao pode ler estado mutando.
    const snapshot = encodeWorkspaceDocument(active.document)
    const doc = decodeWorkspaceDocument(snapshot)
    try {
      await this.persistence.saveWorkspace(doc)
      // So limpa o dirty se nada marcou de novo durante a gravacao.
      if (this.active === active) active.isDirty = false
      log.debug(`workspace gravado (${doc.payload.nodes.length} nos)`)
    } catch (e) {
      // Mantem dirty: a proxima rodada tenta de novo.
      log.error(`falha ao gravar workspace: ${String(e)}`)
    } finally {
      this.saving = false
    }
  }

  /** Chamado no encerramento: grava e marca shutdown limpo. */
  async shutdown(): Promise<void> {
    if (this.autosaveTimer) clearInterval(this.autosaveTimer)
    this.autosaveTimer = undefined
    this.markDirty()
    await this.flush()
    this.appState.cleanShutdown = true
    await this.persistence.saveAppState(this.appState)
    log.info('estado gravado; shutdown limpo')
  }

  /** Centro geometrico dos nos, usado para criar o proximo nó numa area livre. */
  centerOfNodes(): { x: number; y: number } {
    const nodes = this.active?.document.payload.nodes ?? []
    if (nodes.length === 0) {
      const origin = this.active?.document.payload.canvasOrigin ?? { x: 9800, y: 8500 }
      return origin
    }
    const centers = nodes.map((n) => frameCenter(n.frame))
    return {
      x: centers.reduce((sum, c) => sum + c.x, 0) / centers.length,
      y: centers.reduce((sum, c) => sum + c.y, 0) / centers.length,
    }
  }
}
