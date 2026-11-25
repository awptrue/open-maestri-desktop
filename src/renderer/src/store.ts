/**
 * Estado do canvas no renderer.
 *
 * O main e a autoridade sobre o conteudo persistido; aqui mantemos apenas a copia
 * de trabalho para renderizar a 60 fps. Edicao de viewport (pan/zoom) e de frame
 * e local durante o gesto; o valor so sobe ao main no fim dele (`commitViewport`,
 * `commitNodeFrame`).
 */

import { create } from 'zustand'

import { CANVAS_INITIAL_ORIGIN, CANVAS_MAX_ZOOM, CANVAS_MIN_ZOOM } from '@shared/constants'
import type { Frame, Point } from '@shared/models/geometry'
import type {
  CanvasNode,
  NoteConnection,
  PortalConnection,
  PortalToPortalConnection,
  TerminalConnection,
  WorkspaceDocument,
  WorkspacePayload,
} from '@shared/models/workspace'

export interface Viewport {
  /** Canto superior esquerdo do mundo visivel. */
  origin: Point
  zoom: number
}

export interface CanvasState {
  document?: WorkspaceDocument
  nodes: CanvasNode[]
  connections: TerminalConnection[]
  noteConnections: NoteConnection[]
  portalConnections: PortalConnection[]
  portalToPortalConnections: PortalToPortalConnection[]
  selectedIds: Set<string>
  viewport: Viewport
  /** Origem persistida do workspace, usada por `resetViewport`. */
  initialOrigin?: Point
  panMode: boolean

  setDocument(doc: WorkspaceDocument): void
  setNodes(nodes: CanvasNode[]): void
  select(id: string | undefined, additive?: boolean): void
  clearSelection(): void
  panBy(dx: number, dy: number): void
  zoomAt(factor: number, anchor: Point): void
  setZoom(zoom: number): void
  setInitialOrigin(origin: Point): void
  resetViewport(): void
  togglePanMode(): void
  moveNode(id: string, x: number, y: number): void
  /**
   * Aplica um frame vindo do main (ex.: CLI moveu o no). Diferente de `moveNode`,
   * que e o gesto local do usuario.
   */
  applyNodeFrame(id: string, frame: Frame): void
  /** Insere um no criado pelo main, mantendo `document.payload` coerente. */
  appendNode(node: CanvasNode): void
  /** Remove nos localmente apos o main confirmar a remocao. */
  removeNodes(ids: string[]): void
  /** Redimensionamento local do gesto; persiste no fim via `commitNodeFrame`. */
  resizeNode(id: string, frame: Frame): void
}

export function clampZoom(zoom: number): number {
  return Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, zoom))
}

function connectionSlices(payload: WorkspacePayload): Pick<
  CanvasState,
  'connections' | 'noteConnections' | 'portalConnections' | 'portalToPortalConnections'
> {
  return {
    connections: payload.connections,
    noteConnections: payload.noteConnections,
    portalConnections: payload.portalConnections,
    portalToPortalConnections: payload.portalToPortalConnections,
  }
}

export const useCanvasStore = create<CanvasState>((set) => ({
  nodes: [],
  connections: [],
  noteConnections: [],
  portalConnections: [],
  portalToPortalConnections: [],
  selectedIds: new Set(),
  viewport: { origin: { ...CANVAS_INITIAL_ORIGIN }, zoom: 1 },
  panMode: false,

  /**
   * Troca o workspace inteiro. O viewport nasce na origem persistida: sem isso o
   * culling usa (0,0) e a tela abre vazia, porque os nos vivem em torno de
   * (9800, 8500).
   */
  setDocument: (doc) =>
    set({
      document: doc,
      nodes: doc.payload.nodes,
      ...connectionSlices(doc.payload),
      selectedIds: new Set(),
      initialOrigin: { ...doc.payload.canvasOrigin },
      viewport: {
        origin: { ...doc.payload.canvasOrigin },
        zoom: clampZoom(doc.payload.canvasZoom || 1),
      },
    }),

  setNodes: (nodes) => set((state) => {
    // Mantem o documento coerente: o resto do app le `document.payload`.
    if (state.document) {
      state.document.payload.nodes = nodes
    }
    return { nodes }
  }),

  select: (id, additive = false) =>
    set((state) => {
      if (id === undefined) return { selectedIds: new Set() }
      if (!additive) return { selectedIds: new Set([id]) }
      const next = new Set(state.selectedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selectedIds: next }
    }),

  clearSelection: () => set({ selectedIds: new Set() }),

  panBy: (dx, dy) =>
    set((state) => ({
      viewport: {
        ...state.viewport,
        origin: { x: state.viewport.origin.x + dx, y: state.viewport.origin.y + dy },
      },
    })),

  /**
   * Zoom ancorado num ponto da tela: o conteudo sob o cursor nao se move.
   * `anchor` esta em coordenadas de tela (relativas ao container).
   */
  zoomAt: (factor, anchor) =>
    set((state) => {
      const { origin, zoom } = state.viewport
      const next = clampZoom(zoom * factor)
      if (next === zoom) return state
      // O mundo sob o cursor e mantido: screen = (world - origin) * zoom
      const worldX = anchor.x / zoom + origin.x
      const worldY = anchor.y / zoom + origin.y
      return {
        viewport: {
          zoom: next,
          origin: { x: worldX - anchor.x / next, y: worldY - anchor.y / next },
        },
      }
    }),

  setZoom: (zoom) =>
    set((state) => ({ viewport: { ...state.viewport, zoom: clampZoom(zoom) } })),

  /** Recentraliza na origem do workspace, nao em (0,0). */
  resetViewport: () =>
    set((state) => ({
      viewport: { origin: { ...(state.initialOrigin ?? CANVAS_INITIAL_ORIGIN) }, zoom: 1 },
    })),

  setInitialOrigin: (origin) => set({ initialOrigin: origin }),

  togglePanMode: () => set((state) => ({ panMode: !state.panMode })),

  moveNode: (id, x, y) =>
    set((state) => {
      const nodes = state.nodes.map((node) =>
        node.id === id ? { ...node, frame: { ...node.frame, x, y } } : node,
      )
      if (state.document) state.document.payload.nodes = nodes
      return { nodes }
    }),

  applyNodeFrame: (id, frame) =>
    set((state) => {
      const nodes = state.nodes.map((node) => (node.id === id ? { ...node, frame } : node))
      if (state.document) state.document.payload.nodes = nodes
      return { nodes }
    }),

  resizeNode: (id, frame) =>
    set((state) => {
      const nodes = state.nodes.map((node) => (node.id === id ? { ...node, frame } : node))
      if (state.document) state.document.payload.nodes = nodes
      return { nodes }
    }),

  appendNode: (node) =>
    set((state) => {
      // Ja existe (evento duplicado)? Ignora em vez de duplicar o nó na tela.
      if (state.nodes.some((n) => n.id === node.id)) return state
      const nodes = [...state.nodes, node]
      if (state.document) state.document.payload.nodes = nodes
      return { nodes }
    }),

  removeNodes: (ids) =>
    set((state) => {
      const gone = new Set(ids)
      const nodes = state.nodes.filter((n) => !gone.has(n.id))
      const connections = state.connections.filter((c) => !gone.has(c.terminalIdA) && !gone.has(c.terminalIdB))
      const noteConnections = state.noteConnections.filter(
        (c) => !gone.has(c.terminalId) && !gone.has(c.noteNodeId),
      )
      const portalConnections = state.portalConnections.filter(
        (c) => !gone.has(c.terminalId) && !gone.has(c.portalNodeId),
      )
      if (state.document) {
        const payload = state.document.payload
        payload.nodes = nodes
        payload.connections = connections
        payload.noteConnections = noteConnections
        payload.portalConnections = portalConnections
        payload.portalToPortalConnections = state.portalToPortalConnections.filter(
          (c) => !gone.has(c.portalIdA) && !gone.has(c.portalIdB),
        )
      }
      return { nodes, connections, noteConnections, portalConnections, selectedIds: new Set() }
    }),
}))

/** Converte coordenada de tela para coordenada de mundo. */
export function screenToWorld(viewport: Viewport, screen: Point): Point {
  return {
    x: screen.x / viewport.zoom + viewport.origin.x,
    y: screen.y / viewport.zoom + viewport.origin.y,
  }
}

/** Converte coordenada de mundo para tela. */
export function worldToScreen(viewport: Viewport, world: Point): Point {
  return {
    x: (world.x - viewport.origin.x) * viewport.zoom,
    y: (world.y - viewport.origin.y) * viewport.zoom,
  }
}

/** Regiao visivel em coordenadas de mundo, para culling. */
export function visibleWorldFrame(
  viewport: Viewport,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: viewport.origin.x,
    y: viewport.origin.y,
    width: width / viewport.zoom,
    height: height / viewport.zoom,
  }
}

export function getViewport(): Viewport {
  return useCanvasStore.getState().viewport
}
