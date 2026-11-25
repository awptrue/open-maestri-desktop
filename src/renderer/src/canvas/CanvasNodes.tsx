import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

import { NOTE_MIN_HEIGHT, NOTE_MIN_WIDTH, TERMINAL_MIN_HEIGHT, TERMINAL_MIN_WIDTH } from '@shared/constants'
import { frameIntersects, type Frame, type Point } from '@shared/models/geometry'
import type { CanvasNode } from '@shared/models/workspace'
import type { NodeContentType } from '@shared/models/node-content'

import { useCanvasStore, visibleWorldFrame, type Viewport as ViewportState } from '../store'
import { ConnectionDraft } from './ConnectionLayer'
import { FileTreeNode } from './FileTreeNode'
import { NodeChrome } from './NodeChrome'
import { NoteNode } from './NoteNode'
import { TerminalNode } from './TerminalNode'

interface Props {
  /** Tamanho visivel do canvas em pixels de tela. */
  width: number
  height: number
  selectedIds: Set<string>
  onSelect: (id: string, additive: boolean) => void
  onDrag: (id: string, x: number, y: number) => void
  /** Redimensionamento ao vivo; o commit vai pelo `onDragEnd`. */
  onResize: (id: string, frame: Frame) => void
  /** Chamado ao soltar o no, para o main persistir o frame final. */
  onDragEnd?: (id: string) => void
  onConnect?: (fromId: string, toId: string) => void
}

const CULL_MARGIN = 200

type GripEvent = ReactPointerEvent<HTMLButtonElement>
type Draft = { fromId: string; from: Point; to: Point; targetId?: string }
type Gesture = { fromId: string; from: Point; pointerId: number; world: Element; grip: HTMLButtonElement }

function worldPoint(world: Element, clientX: number, clientY: number): Point {
  const rect = world.getBoundingClientRect()
  const zoom = useCanvasStore.getState().viewport.zoom
  return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom }
}

function targetAt(gesture: Gesture, event: GripEvent): string | undefined {
  const { world, fromId } = gesture
  const hit = world.ownerDocument.elementFromPoint(event.clientX, event.clientY)
    ?.closest<HTMLElement>('[data-canvas-node-id]')
  if (hit?.parentElement !== world) return undefined
  const toId = hit.dataset.canvasNodeId
  if (!toId || toId === fromId) return undefined

  const { nodes, connections, noteConnections, portalConnections } = useCanvasStore.getState()
  const from = nodes.find((node) => node.id === fromId)
  const to = nodes.find((node) => node.id === toId)
  if (!from || !to) return undefined
  const terminal = from.content.type === 'terminal' ? from : to
  const other = terminal === from ? to : from
  if (terminal.content.type !== 'terminal') return undefined

  const terminalId = terminal.content.value.id
  switch (other.content.type) {
    case 'terminal': {
      const otherId = other.content.value.id
      return otherId !== terminalId && !connections.some(({ terminalIdA, terminalIdB }) =>
        (terminalIdA === terminalId && terminalIdB === otherId) || (terminalIdA === otherId && terminalIdB === terminalId),
      ) ? toId : undefined
    }
    case 'stickyNote':
      return noteConnections.some((link) => link.terminalId === terminalId && link.noteNodeId === other.id)
        ? undefined : toId
    case 'portal':
      return portalConnections.some((link) => link.terminalId === terminalId && link.portalNodeId === other.id)
        ? undefined : toId
    default:
      return undefined
  }
}

/** Cor de destaque por tipo, igual aos presets do macOS. */
export const NODE_ACCENT: Record<NodeContentType, string> = {
  terminal: '#007AFF',
  stickyNote: '#FEFDE8',
  portal: '#34C759',
  fileTree: '#FF9500',
  text: '#8E8E93',
  shape: '#5856D6',
  stroke: '#8E8E93',
  freehand: '#FF2D55',
}

/** Tamanhos default por tipo, iguais a `WorkspaceCanvasView+NodeCreation.swift`. */
export const NODE_DEFAULT_SIZE: Record<NodeContentType, { width: number; height: number }> = {
  terminal: { width: 600, height: 400 },
  stickyNote: { width: 300, height: 240 },
  portal: { width: 500, height: 380 },
  fileTree: { width: 360, height: 480 },
  text: { width: 200, height: 60 },
  shape: { width: 200, height: 160 },
  stroke: { width: 200, height: 60 },
  freehand: { width: 200, height: 100 },
}

/** Tipos cujo corpo tem processo/estado proprio e so deve vivo perto da tela. */
const LIVE_TYPES: ReadonlySet<NodeContentType> = new Set<NodeContentType>([
  'terminal',
  'stickyNote',
  'fileTree',
])

function visibleFrame(viewport: ViewportState, width: number, height: number): ReturnType<typeof visibleWorldFrame> {
  return visibleWorldFrame(viewport, width, height)
}

export function nodeLabel(node: CanvasNode): string {
  switch (node.content.type) {
    case 'terminal':
      return node.content.value.name
    case 'portal':
      return node.content.value.name
    case 'fileTree':
      return node.content.value.name
    case 'stickyNote':
      return node.content.value.fileName?.replace(/\.md$/, '') ?? 'Note'
    case 'text':
      return node.content.value.text.slice(0, 40) || 'Text'
    case 'shape':
      return node.content.value.shapeType
    case 'stroke':
      return node.content.value.strokeType
    case 'freehand':
      return node.content.value.freehandType
  }
}

export function CanvasNodes({
  width,
  height,
  selectedIds,
  onSelect,
  onDrag,
  onResize,
  onDragEnd,
  onConnect,
}: Props): React.JSX.Element {
  const nodes = useCanvasStore((s) => s.nodes)
  const viewport = useCanvasStore((s) => s.viewport)
  const workspaceId = useCanvasStore((s) => s.document?.payload.id)
  const gestureRef = useRef<Gesture | undefined>(undefined)
  const [draft, setDraft] = useState<Draft>()
  const [noteModes, setNoteModes] = useState<Record<string, boolean>>({})

  const clearGesture = useCallback(() => {
    const gesture = gestureRef.current
    gestureRef.current = undefined
    if (gesture?.grip.hasPointerCapture(gesture.pointerId)) {
      gesture.grip.releasePointerCapture(gesture.pointerId)
    }
  }, [])

  const cancelGesture = useCallback(() => {
    clearGesture()
    setDraft(undefined)
  }, [clearGesture])

  useEffect(() => {
    cancelGesture()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !gestureRef.current) return
      event.preventDefault()
      cancelGesture()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', cancelGesture)
    return () => {
      clearGesture()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', cancelGesture)
    }
  }, [workspaceId, clearGesture, cancelGesture])

  const startConnection = useCallback((event: GripEvent, fromId: string) => {
    event.stopPropagation()
    if (event.button !== 0 || gestureRef.current) return
    const grip = event.currentTarget
    const world = grip.closest('.canvas-world')
    if (!world) return
    event.preventDefault()
    const rect = grip.getBoundingClientRect()
    const from = worldPoint(world, rect.left + rect.width / 2, rect.top + rect.height / 2)
    grip.setPointerCapture(event.pointerId)
    gestureRef.current = { fromId, from, pointerId: event.pointerId, world, grip }
    setDraft({ fromId, from, to: worldPoint(world, event.clientX, event.clientY) })
  }, [])

  const moveConnection = useCallback((event: GripEvent) => {
    const gesture = gestureRef.current
    if (gesture?.pointerId !== event.pointerId) return
    event.stopPropagation()
    setDraft({
      fromId: gesture.fromId,
      from: gesture.from,
      to: worldPoint(gesture.world, event.clientX, event.clientY),
      targetId: targetAt(gesture, event),
    })
  }, [])

  const endConnection = useCallback((event: GripEvent) => {
    const gesture = gestureRef.current
    if (gesture?.pointerId !== event.pointerId) return
    event.stopPropagation()
    const targetId = targetAt(gesture, event)
    cancelGesture()
    if (targetId) onConnect?.(gesture.fromId, targetId)
  }, [cancelGesture, onConnect])

  const cancelConnection = useCallback((event: GripEvent) => {
    if (gestureRef.current?.pointerId === event.pointerId) cancelGesture()
  }, [cancelGesture])

  const toggleNotePreview = useCallback((id: string, previewing: boolean) => {
    setNoteModes((modes) => ({ ...modes, [id]: !previewing }))
  }, [])

  const view = visibleFrame(viewport, width, height)

  // Ordenacao ascendente por zIndex: o maior z pinta por ultimo.
  const ordered = useMemo(() => [...nodes].sort((a, b) => a.zIndex - b.zIndex), [nodes])

  return (
    <>
      {draft && <ConnectionDraft from={draft.from} to={draft.to} valid={draft.targetId !== undefined} />}
      {ordered.map((node) => {
        // Culling: node fora do viewport (com margem) nao renderiza.
        if (!frameIntersects(node.frame, view, CULL_MARGIN)) return null
        const selected = selectedIds.has(node.id)
        // `active` controla apenas o que custa caro (PTY, leitura de nota):
        // a margem e maior que o culling para o corpo nao "acordar" no limite.
        const active = frameIntersects(node.frame, view, CULL_MARGIN * 2)
        return (
          <NodeShell
            key={node.id}
            node={node}
            selected={selected}
            active={active}
            onSelect={onSelect}
            onDrag={onDrag}
            onResize={onResize}
            onDragEnd={onDragEnd}
            connectSource={draft?.fromId === node.id}
            connectTarget={draft?.targetId === node.id}
            onConnectStart={onConnect ? startConnection : undefined}
            onConnectMove={moveConnection}
            onConnectEnd={endConnection}
            onConnectCancel={cancelConnection}
            previewing={noteModes[node.id]}
            onToggleNotePreview={toggleNotePreview}
          />
        )
      })}
    </>
  )
}

interface ShellProps {
  node: CanvasNode
  selected: boolean
  active: boolean
  onSelect: (id: string, additive: boolean) => void
  onDrag: (id: string, x: number, y: number) => void
  onResize: (id: string, frame: Frame) => void
  onDragEnd?: (id: string) => void
  connectSource: boolean
  connectTarget: boolean
  onConnectStart?: (event: GripEvent, fromId: string) => void
  onConnectMove: (event: GripEvent) => void
  onConnectEnd: (event: GripEvent) => void
  onConnectCancel: (event: GripEvent) => void
  previewing?: boolean
  onToggleNotePreview: (id: string, previewing: boolean) => void
}

/** Tamanho minimo por tipo: um terminal com 40px de altura nao desenha nada. */
const MIN_SIZE: Record<NodeContentType, { width: number; height: number }> = {
  terminal: { width: TERMINAL_MIN_WIDTH, height: TERMINAL_MIN_HEIGHT },
  stickyNote: { width: NOTE_MIN_WIDTH, height: NOTE_MIN_HEIGHT },
  portal: { width: 240, height: 180 },
  fileTree: { width: 200, height: 160 },
  text: { width: 80, height: 32 },
  shape: { width: 40, height: 40 },
  stroke: { width: 40, height: 20 },
  freehand: { width: 40, height: 40 },
}

const NodeShell = memo(function NodeShell({
  node,
  selected,
  active,
  onSelect,
  onDrag,
  onResize,
  onDragEnd,
  connectSource,
  connectTarget,
  onConnectStart,
  onConnectMove,
  onConnectEnd,
  onConnectCancel,
  previewing,
  onToggleNotePreview,
}: ShellProps): React.JSX.Element {
  const accent = NODE_ACCENT[node.content.type]
  const label = nodeLabel(node)
  const { type } = node.content
  const canConnect = type === 'terminal' || type === 'stickyNote' || type === 'portal'
  const notePreview = type === 'stickyNote' ? (previewing ?? node.content.value.isPreviewing) : undefined

  /**
   * Redimensionar pela alca do canto: o xterm e o file tree dependem de medidas
   * reais, e um no de tamanho fixo nao serve para ler um log longo.
   */
  const startResize = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>): void => {
      if (e.button !== 0) return
      e.stopPropagation()
      onSelect(node.id, false)
      if (node.isLocked) return

      const startX = e.clientX
      const startY = e.clientY
      const startFrame = { ...node.frame }
      const zoom = useCanvasStore.getState().viewport.zoom
      const min = MIN_SIZE[node.content.type]
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)

      const move = (ev: PointerEvent): void => {
        const width = Math.max(min.width, startFrame.width + (ev.clientX - startX) / zoom)
        const height = Math.max(min.height, startFrame.height + (ev.clientY - startY) / zoom)
        onResize(node.id, { ...startFrame, width, height })
      }
      const finish = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
        if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId)
        onDragEnd?.(node.id)
      }

      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', finish)
    },
    [node.id, node.isLocked, node.frame, node.content.type, onResize, onDragEnd, onSelect],
  )

  /**
   * Arrastar so pelo cabecalho. Se o corpo inteiro capturase o ponteiro, o
   * usuario nao conseguiria clicar num terminal, selecionar texto de nota ou
   * abrir uma pasta do file tree.
   */
  const startDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (e.button !== 0) return
      e.stopPropagation()
      onSelect(node.id, e.shiftKey)
      if (node.isLocked || e.shiftKey) return

      const startX = e.clientX
      const startY = e.clientY
      const baseX = node.frame.x
      const baseY = node.frame.y
      // O delta chega em pixels de TELA; o frame esta em coordenadas de mundo.
      // Sem dividir pelo zoom, o no descola do cursor em qualquer zoom != 1.
      const zoom = useCanvasStore.getState().viewport.zoom
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)
      let moved = false

      const move = (ev: PointerEvent): void => {
        if (Math.abs(ev.clientX - startX) > 1 || Math.abs(ev.clientY - startY) > 1) moved = true
        onDrag(node.id, baseX + (ev.clientX - startX) / zoom, baseY + (ev.clientY - startY) / zoom)
      }
      const finish = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
        if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId)
        // Persistir apenas o frame final: cada pixel do arrasto nao pode virar
        // um IPC nem marcar o workspace como sujo 60 vezes por segundo.
        if (moved) onDragEnd?.(node.id)
      }

      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', finish)
    },
    [node.id, node.isLocked, node.frame.x, node.frame.y, onDrag, onDragEnd, onSelect],
  )

  return (
    <div
      className={`node-shell node-shell--${type}${selected ? ' is-selected' : ''}${node.isLocked ? ' is-locked' : ''}${connectSource ? ' is-connect-source' : ''}${connectTarget ? ' is-connect-target' : ''}`}
      style={{
        '--node-accent': accent,
        left: node.frame.x,
        top: node.frame.y,
        width: node.frame.width,
        height: node.frame.height,
        zIndex: node.zIndex,
      } as CSSProperties}
      data-canvas-node-id={node.id}
      onPointerDown={(e) => {
        // Seleciona sem arrastar quando o clique comeca no corpo. `shiftKey`
        // acumula: e assim que o usuario escolhe os dois nos a conectar.
        e.stopPropagation()
        if (e.button !== 0) return
        onSelect(node.id, e.shiftKey)
      }}
      role="group"
      aria-label={`${node.content.type}: ${label}`}
    >
      {type !== 'text' && (
        <NodeChrome type={type} label={label} onDrag={startDrag}
          status={type === 'terminal' ? node.content.value.status : undefined}
          previewing={notePreview}
          onTogglePreview={notePreview === undefined ? undefined : () => onToggleNotePreview(node.id, notePreview)}
          onConnectStart={canConnect && onConnectStart ? (event) => onConnectStart(event, node.id) : undefined}
          onConnectMove={onConnectMove} onConnectEnd={onConnectEnd} onConnectCancel={onConnectCancel} />
      )}
      <div className="node-body" onPointerDown={type === 'text' ? startDrag : undefined}>
        <NodeBody node={node} active={active} previewing={notePreview} />
      </div>
      {!node.isLocked ? (
        <span
          className="node-resize-handle"
          onPointerDown={startResize}
          title="Redimensionar"
          aria-hidden="true"
        />
      ) : null}
    </div>
  )
})

function NodeBody({ node, active, previewing }: { node: CanvasNode; active: boolean; previewing?: boolean }): React.ReactElement {
  const live = active && LIVE_TYPES.has(node.content.type)
  switch (node.content.type) {
    case 'terminal':
      return live ? (
        <TerminalNode content={node.content.value} active />
      ) : (
        <div className="node-terminal-placeholder">
          <code>{node.content.value.command || node.content.value.agentType}</code>
          <span className="node-muted">{node.content.value.workingDirectory}</span>
        </div>
      )
    case 'stickyNote':
      return live ? (
        <NoteNode key={node.content.value.fileName} content={node.content.value} active previewing={previewing} />
      ) : <div className="node-note-placeholder">Nota</div>
    case 'fileTree':
      return live ? (
        <FileTreeNode content={node.content.value} active />
      ) : (
        <div className="node-muted">{node.content.value.rootPath}</div>
      )
    case 'portal':
      return <div className="node-muted">{node.content.value.currentURL || 'sem URL'}</div>
    case 'text':
      return <div className="node-text">{node.content.value.text || '(vazio)'}</div>
    case 'shape':
      return <div className="node-muted">{node.content.value.shapeType}</div>
    case 'stroke':
      return <div className="node-muted">{node.content.value.strokeType}</div>
    case 'freehand':
      return <div className="node-muted">{node.content.value.freehandType}</div>
  }
}
