import { useCallback, useEffect, useRef } from 'react'

import { CANVAS_ZOOM_STEP } from '@shared/constants'
import type { Point } from '@shared/models/geometry'

import { useCanvasStore } from '../store'

interface Props {
  /** Conteudo do canvas em coordenadas de mundo. */
  children: React.ReactNode
  /** Handler de clique no fundo (limpa selecao). */
  onBackgroundClick?: () => void
}

/**
 * Viewport do canvas infinito.
 *
 * Pan: arrastar com o botao do meio, ou com Shift+arrastar, ou Espaco+arrastar.
 * Zoom: roda do mouse ancorada no cursor; +/- para incremento.
 *
 * O transform e aplicado num unico wrapper, entao nos e conexoes vivem em
 * coordenadas de mundo e nao sabem do viewport.
 */
export function Viewport({ children, onBackgroundClick }: Props): React.JSX.Element {
  const viewport = useCanvasStore((s) => s.viewport)
  const panBy = useCanvasStore((s) => s.panBy)
  const zoomAt = useCanvasStore((s) => s.zoomAt)
  const setZoom = useCanvasStore((s) => s.setZoom)
  const panMode = useCanvasStore((s) => s.panMode)

  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number } | undefined>(undefined)
  const spaceRef = useRef(false)
  const movedRef = useRef(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !e.repeat) {
        spaceRef.current = true
        document.body.style.cursor = 'grab'
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        setZoom(useCanvasStore.getState().viewport.zoom + CANVAS_ZOOM_STEP)
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        setZoom(useCanvasStore.getState().viewport.zoom - CANVAS_ZOOM_STEP)
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        spaceRef.current = false
        document.body.style.cursor = ''
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      document.body.style.cursor = ''
    }
  }, [setZoom])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const isPan = e.button === 1 || e.shiftKey || spaceRef.current || panMode
      if (!isPan) return
      e.preventDefault()
      dragRef.current = { x: e.clientX, y: e.clientY }
      movedRef.current = false
      e.currentTarget.setPointerCapture(e.pointerId)
      document.body.style.cursor = 'grabbing'
    },
    [panMode],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      if (dx !== 0 || dy !== 0) movedRef.current = true
      dragRef.current = { x: e.clientX, y: e.clientY }
      panBy(dx, dy)
    },
    [panBy],
  )

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = undefined
    document.body.style.cursor = ''
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    if (!movedRef.current) onBackgroundClick?.()
  }, [onBackgroundClick])

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      // Ctrl+roda = zoom; roda pura tambem, porque no canvas nao ha scroll vertical.
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const anchor: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      zoomAt(factor, anchor)
    },
    [zoomAt],
  )

  return (
    <div
      ref={rootRef}
      className="canvas-viewport"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={onWheel}
    >
      <div
        className="canvas-world"
        style={{
          // screen = (world - origin) * zoom
          transform: `scale(${viewport.zoom}) translate(${-viewport.origin.x}px, ${-viewport.origin.y}px)`,
          transformOrigin: '0 0',
        }}
      >
        {children}
      </div>
    </div>
  )
}
