/**
 * Geometria do canvas.
 *
 * O open-maestri do macOS grava `CanvasNode.frame` como `[[x, y], [w, h]]`
 * (array de arrays), nunca como objeto CGRect. Ver `CGRect+Frame.swift`.
 */

export interface Point {
  x: number
  y: number
}

export interface Frame {
  x: number
  y: number
  width: number
  height: number
}

export type FrameArray = [[number, number], [number, number]]

export function frameToArray(frame: Frame): FrameArray {
  return [
    [frame.x, frame.y],
    [frame.width, frame.height],
  ]
}

/**
 * Converte `[[x,y],[w,h]]` em Frame. Retorna `undefined` para qualquer formato
 * invalido — o Swift faz o mesmo (`init?(frameArray:)` retorna nil).
 */
export function frameFromArray(value: unknown): Frame | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined
  const [origin, size] = value
  if (!Array.isArray(origin) || origin.length !== 2) return undefined
  if (!Array.isArray(size) || size.length !== 2) return undefined
  const [x, y] = origin
  const [width, height] = size
  if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined
  return { x, y, width, height }
}

/** Converte pontos (usados em `ropePoints`, `drawings.points`, freehand). */
export function pointsToArray(points: Point[]): [number, number][] {
  return points.map((p) => [p.x, p.y])
}

export function pointsFromArray(value: unknown): Point[] {
  if (!Array.isArray(value)) return []
  const out: Point[] = []
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) continue
    const [x, y] = entry
    if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) {
      out.push({ x, y })
    }
  }
  return out
}

export function pointFromArray(value: unknown): Point | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined
  const [x, y] = value
  if (typeof x !== 'number' || typeof y !== 'number') return undefined
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
  return { x, y }
}

/** Ponto em coordenadas normalizadas (0–1) dentro do frame de um no. */
export function pointToArray(p: Point): [number, number] {
  return [p.x, p.y]
}

export function clampFrame(frame: Frame, minWidth: number, minHeight: number): Frame {
  return {
    x: frame.x,
    y: frame.y,
    width: Math.max(minWidth, frame.width),
    height: Math.max(minHeight, frame.height),
  }
}

export function frameIntersects(a: Frame, b: Frame, margin = 0): boolean {
  return !(
    a.x + a.width < b.x - margin ||
    b.x + b.width < a.x - margin ||
    a.y + a.height < b.y - margin ||
    b.y + b.height < a.y - margin
  )
}

export function frameCenter(frame: Frame): Point {
  return { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }
}
