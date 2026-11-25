/**
 * Shell do app: carrega o workspace do main, desenha o canvas e devolve as
 * intencoes do usuario (mover no, selecionar, mover viewport).
 *
 * O renderer nunca escreve JSON: cada acao vira um `api.workspace.*`, e o main
 * e quem grava. O autosave de verdade e o do main (intervalo fixo); aqui so
 * commitamos o frame no fim do gesto, para nao gerar um IPC por pixel.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { CANVAS_ZOOM_STEP } from '@shared/constants'
import { createStickyNoteContent, createTerminalContent, createTextContent } from '@shared/models/node-content'

import { api, hasBridge } from './api'
import { CanvasNodes, NODE_DEFAULT_SIZE } from './canvas/CanvasNodes'
import { ConnectionLayer, flattenConnections } from './canvas/ConnectionLayer'
import { Viewport } from './canvas/Viewport'
import { useCanvasStore } from './store'

interface ViewportSnapshot {
  origin: { x: number; y: number }
  zoom: number
}

export function App(): React.JSX.Element {
  const document = useCanvasStore((s) => s.document)
  const nodes = useCanvasStore((s) => s.nodes)
  const connections = useCanvasStore((s) => s.connections)
  const noteConnections = useCanvasStore((s) => s.noteConnections)
  const portalConnections = useCanvasStore((s) => s.portalConnections)
  const portalToPortalConnections = useCanvasStore((s) => s.portalToPortalConnections)
  const setDocument = useCanvasStore((s) => s.setDocument)
  const selectedIds = useCanvasStore((s) => s.selectedIds)
  const select = useCanvasStore((s) => s.select)
  const clearSelection = useCanvasStore((s) => s.clearSelection)
  const viewport = useCanvasStore((s) => s.viewport)
  const setZoom = useCanvasStore((s) => s.setZoom)
  const moveNode = useCanvasStore((s) => s.moveNode)

  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [booting, setBooting] = useState(true)
  const [bootError, setBootError] = useState<string | undefined>(undefined)

  // -------------------------------------------------------------------------
  // Boot: abre o workspace ativo (ou cria um) no processo main.
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const snapshot = await api.workspace.open({
          name: 'Meu Workspace',
          workingDirectory: '',
        })
        if (cancelled) return
        if (!snapshot) {
          setBootError('Nao foi possivel abrir ou criar o workspace.')
          return
        }
        setDocument(snapshot.document)
      } catch (e) {
        if (!cancelled) setBootError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setBooting(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setDocument])

  // Mudancas vindas do main (autosave de outro lugar, comando do CLI).
  useEffect(() => {
    return api.workspace.onChanged(({ document: next }) => setDocument(next))
  }, [setDocument])

  /**
   * Sobe o PTY de TODO nó terminal, mesmo os fora da tela.
   *
   * O PTY e o agente: se ele so nascer quando o nó entra no viewport, um
   * workspace reaberto com a camera em outra area deixa os agentes mortos e o
   * `omaestri list` vazio. O xterm (barato de montar, caro de manter) continua
   * condicionado a visibilidade em `TerminalNode`.
   */
  useEffect(() => {
    const payload = document?.payload
    if (!payload) return
    let cancelled = false
    for (const node of payload.nodes) {
      if (node.content.type !== 'terminal') continue
      const content = node.content.value
      // `terminal.create` e idempotente: no visivel ja criou; aqui nao duplica.
      void api.terminal
        .create({
          terminalId: content.id,
          agentType: content.agentType,
          command: content.command,
          workingDirectory: content.workingDirectory,
          shellPath: content.shellPath || undefined,
          cols: 120,
          rows: 32,
        })
        .then((result) => {
          if (cancelled || result.running) return
          console.warn(`PTY de ${content.name} nao subiu: ${result.error ?? 'motivo desconhecido'}`)
        })
    }
    return () => {
      cancelled = true
    }
  }, [document])

  // Tamanho real do canvas: sem isso o culling usa um viewport errado.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // -------------------------------------------------------------------------
  // Persistencia do viewport: so no fim do gesto, nunca a cada evento.
  // -------------------------------------------------------------------------
  const lastCommitted = useRef<ViewportSnapshot | undefined>(undefined)
  useEffect(() => {
    if (!document) return
    const timer = setTimeout(() => {
      const previous = lastCommitted.current
      if (previous && previous.origin.x === viewport.origin.x && previous.origin.y === viewport.origin.y && previous.zoom === viewport.zoom) {
        return
      }
      lastCommitted.current = { origin: { ...viewport.origin }, zoom: viewport.zoom }
      void api.workspace.setViewport({ origin: viewport.origin, zoom: viewport.zoom })
    }, 500)
    return () => clearTimeout(timer)
  }, [document, viewport])

  const rendered = useMemo(
    () =>
      connections.length + noteConnections.length + portalConnections.length + portalToPortalConnections.length,
    [connections, noteConnections, portalConnections, portalToPortalConnections],
  )
  const connectionSets = useMemo(
    () => ({ connections, noteConnections, portalConnections, portalToPortalConnections, noteToNoteConnections: [] }),
    [connections, noteConnections, portalConnections, portalToPortalConnections],
  )

  const renderedConnections = useMemo(() => flattenConnections(connectionSets), [connectionSets])

  const firstSelected = selectedIds.size === 1 ? [...selectedIds][0] : undefined

  const onSelect = useCallback((id: string, additive: boolean) => select(id, additive), [select])
  const onDrag = useCallback((id: string, x: number, y: number) => moveNode(id, x, y), [moveNode])
  const onResize = useCallback(
    (id: string, frame: { x: number; y: number; width: number; height: number }) =>
      useCanvasStore.getState().resizeNode(id, frame),
    [],
  )

  /** Fim do arrasto: manda o frame final ao main, que marca dirty e grava. */
  const onDragEnd = useCallback((id: string) => {
    const node = useCanvasStore.getState().nodes.find((n) => n.id === id)
    if (!node) return
    void api.workspace.updateNodeFrame({ nodeId: id, frame: node.frame })
  }, [])

  // -------------------------------------------------------------------------
  // Conexao entre nos: por arrasto (alcas) e por Shift+clique + Enter
  // -------------------------------------------------------------------------
  /** Cria a conexao entre dois nos e recarrega o documento com os ids do main. */
  const connectNodes = useCallback(async (fromId: string, toId: string) => {
    if (fromId === toId) return
    const created = await api.workspace.addConnection({ aId: fromId, bId: toId })
    if (!created) return
    const snapshot = await api.workspace.open({ workspaceId: useCanvasStore.getState().document?.payload.id })
    if (snapshot) useCanvasStore.getState().setDocument(snapshot.document)
  }, [])

  const connectSelected = useCallback(async () => {
    const ids = [...useCanvasStore.getState().selectedIds]
    if (ids.length !== 2) return
    const [aId, bId] = ids
    if (!aId || !bId) return
    await connectNodes(aId, bId)
  }, [connectNodes])

  const deleteSelected = useCallback(async () => {
    const ids = [...useCanvasStore.getState().selectedIds]
    if (ids.length === 0) return
    for (const id of ids) {
      await api.workspace.removeNode(id)
    }
    useCanvasStore.getState().removeNodes(ids)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Alguem ja tratou (xterm, textarea, menu): nao roubar o atalho.
      if (e.defaultPrevented) return
      const target = e.target as HTMLElement | null
      // Botoes tratam Enter/Espaco como ativacao: apagar nó ou conectar aqui
      // faria a tecla disparar duas acoes diferentes.
      if (target?.tagName === 'BUTTON') return
      const editing =
        target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT' || target?.isContentEditable === true
      if (editing) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        void deleteSelected()
      }
      if (e.key === 'Enter') {
        void connectSelected()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [connectSelected, deleteSelected])

  // -------------------------------------------------------------------------
  // Criacao de nos pela toolbar
  // -------------------------------------------------------------------------
  const createNode = useCallback(
    async (type: 'terminal' | 'stickyNote' | 'text') => {
      const payload = useCanvasStore.getState().document?.payload
      if (!payload) return
      const cwd = payload.workingDirectory || ''

      // Coloca o novo no a direita do conjunto atual, nao em cima de outro.
      // `max(x + largura)` em vez de `max(centro)`: dois nos de tipos
      // diferentes tem larguras diferentes e se sobrepunham com o centro.
      const frames = useCanvasStore.getState().nodes.map((n) => n.frame)
      const baseX =
        frames.length > 0
          ? Math.max(...frames.map((f) => f.x + f.width)) + 80
          : payload.canvasOrigin.x + 100
      const baseY = frames.length > 0 ? Math.min(...frames.map((f) => f.y)) : payload.canvasOrigin.y + 100

      const size = NODE_DEFAULT_SIZE[type]
      const frame = { x: baseX, y: baseY, ...size }

      const request =
        type === 'terminal'
          ? {
              type,
              frame,
              value: createTerminalContent('Terminal', cwd, { agentType: 'generic_shell', command: '' }),
            }
          : type === 'stickyNote'
            ? { type, frame, value: createStickyNoteContent(`Nota ${newIdSuffix()}`) }
            : { type, frame, value: createTextContent('Texto') }

      const created = await api.workspace.addNode(request)
      if (!created) return
      // O main e quem monta o conteudo final (ids, defaults do tipo), entao o nó
      // volta pronto — nao precisa reabrir o workspace inteiro.
      useCanvasStore.getState().appendNode(created)
      select(created.id)
    },
    [select, setDocument],
  )

  const title = document?.payload.name ?? (booting ? 'carregando...' : 'sem workspace')

  return (
    <div className="app-root">
      <header className="app-header">
        <span className="app-title">open-maestri</span>
        <span className="app-subtitle">{title}</span>
        <div className="app-spacer" />
        <button type="button" className="toolbar-button" onClick={() => void createNode('terminal')} disabled={!document}>
          + terminal
        </button>
        <button type="button" className="toolbar-button" onClick={() => void createNode('stickyNote')} disabled={!document}>
          + nota
        </button>
        <button type="button" className="toolbar-button" onClick={() => void createNode('text')} disabled={!document}>
          + texto
        </button>
        <span className="app-zoom">{(viewport.zoom * 100).toFixed(0)}%</span>
        <button type="button" className="toolbar-button" onClick={() => setZoom(viewport.zoom - CANVAS_ZOOM_STEP)}>
          -
        </button>
        <button type="button" className="toolbar-button" onClick={() => setZoom(viewport.zoom + CANVAS_ZOOM_STEP)}>
          +
        </button>
      </header>

      <main className="app-canvas" ref={containerRef}>
        {bootError ? <div className="app-boot-error">{bootError}</div> : null}
        <Viewport onBackgroundClick={clearSelection}>
          <ConnectionLayer connections={renderedConnections} nodes={nodes} selectedId={firstSelected} />
          <CanvasNodes
            width={size.width}
            height={size.height}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onDrag={onDrag}
            onResize={onResize}
            onDragEnd={onDragEnd}
            onConnect={connectNodes}
          />
        </Viewport>
      </main>

      <footer className="app-status">
        <span>{nodes.length} nos</span>
        <span>{rendered} conexoes</span>
        <span>{selectedIds.size} selecionado(s)</span>
        <span className="app-muted">
          {hasBridge() ? 'main conectado' : 'sem bridge (modo web)'} · pan: meio do mouse, Shift ou Space · zoom: roda do mouse
        </span>
      </footer>
    </div>
  )
}

let suffix = 0
function newIdSuffix(): string {
  suffix += 1
  return String(suffix)
}
