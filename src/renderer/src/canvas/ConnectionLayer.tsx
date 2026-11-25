/**
 * Camada de conexoes: cordas entre nos.
 *
 * O macOS guarda 21 pontos de controle por conexao (`ropePoints`) e desenha a
 * corda como curva de Catmull-Rom com leve catenaria. Aqui reconstruimos o mesmo
 * visual a partir dos centros dos nos, sem simular fisica — a v1 usa geometria
 * deterministica, e os `ropePoints` persistidos sao preservados no round-trip.
 */

import type { Point } from '@shared/models/geometry'
import type { CanvasNode } from '@shared/models/workspace'
import type {
  NoteConnection,
  NoteToNoteConnection,
  PortalConnection,
  PortalToPortalConnection,
  TerminalConnection,
} from '@shared/models/workspace'

import { frameCenter } from '@shared/models/geometry'

export type ConnectionKind = 'terminal' | 'note' | 'portal' | 'portalToPortal' | 'noteToNote'

export interface RenderedConnection {
  id: string
  kind: ConnectionKind
  from: string
  to: string
  status: 'idle' | 'communicating' | 'error'
}

export interface ConnectionSets {
  connections: TerminalConnection[]
  noteConnections: NoteConnection[]
  portalConnections: PortalConnection[]
  portalToPortalConnections: PortalToPortalConnection[]
  noteToNoteConnections: NoteToNoteConnection[]
}

export function flattenConnections(sets: ConnectionSets): RenderedConnection[] {
  const out: RenderedConnection[] = []
  for (const c of sets.connections) {
    out.push({ id: c.id, kind: 'terminal', from: c.terminalIdA, to: c.terminalIdB, status: 'idle' })
  }
  for (const c of sets.noteConnections) {
    out.push({ id: c.id, kind: 'note', from: c.terminalId, to: c.noteNodeId, status: 'idle' })
  }
  for (const c of sets.portalConnections) {
    out.push({ id: c.id, kind: 'portal', from: c.terminalId, to: c.portalNodeId, status: 'idle' })
  }
  for (const c of sets.portalToPortalConnections) {
    out.push({ id: c.id, kind: 'portalToPortal', from: c.portalIdA, to: c.portalIdB, status: 'idle' })
  }
  for (const c of sets.noteToNoteConnections) {
    out.push({ id: c.id, kind: 'noteToNote', from: c.noteNodeIdA, to: c.noteNodeIdB, status: 'idle' })
  }
  return out
}

/** Indice id -> frame, para resolver as pontas rapidamente. */
export function nodeFrameIndex(nodes: CanvasNode[]): Map<string, CanvasNode> {
  const map = new Map<string, CanvasNode>()
  for (const node of nodes) {
    map.set(node.id, node)
    // Terminal e portal guardam um id proprio dentro do conteudo; conexoes usam ele.
    if (node.content.type === 'terminal' || node.content.type === 'portal') {
      map.set(node.content.value.id, node)
    }
  }
  return map
}

/**
 * Curva de Catmull-Rom amostrada em `segments` passos, com catenaria leve para
 * a corda nao parecer uma reta rígida.
 */
export function ropePath(
  from: Point,
  to: Point,
  slack = 0.12,
  segments = 24,
): string {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < 1) return ''

  // Vetor perpendicular unitario, usado para a curvatura.
  const nx = -dy / length
  const ny = dx / length
  const sag = length * slack

  const points: Point[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    // Catenaria aproximada por parabola: 4t(1-t) tem pico em t=0.5.
    const drop = 4 * t * (1 - t) * sag
    points.push({
      x: from.x + dx * t + nx * drop,
      y: from.y + dy * t + ny * drop,
    })
  }

  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')
}

export const CONNECTION_STROKE: Record<ConnectionKind, string> = {
  terminal: '#3F8CFF',
  note: '#E3C55B',
  portal: '#3FD07A',
  portalToPortal: '#3FD07A',
  noteToNote: '#E3C55B',
}

export function ConnectionDraft({ from, to, valid }: { from: Point; to: Point; valid: boolean }): React.JSX.Element {
  return (
    <svg className={`connection-layer connection-draft${valid ? ' is-valid' : ''}`} aria-hidden="true">
      <path d={ropePath(from, to, 0.16)} strokeWidth="3" vectorEffect="non-scaling-stroke" />
      <circle cx={to.x} cy={to.y} r={4} />
    </svg>
  )
}

interface Props {
  connections: RenderedConnection[]
  nodes: CanvasNode[]
  selectedId?: string
}

/** Overlay SVG em coordenadas de mundo, atras dos nos. */
export function ConnectionLayer({ connections, nodes, selectedId }: Props): React.JSX.Element {
  const index = nodeFrameIndex(nodes)

  return (
    <svg className="connection-layer" aria-hidden="true">
      {connections.map((conn) => {
        const a = index.get(conn.from)
        const b = index.get(conn.to)
        if (!a || !b) return null

        const from = frameCenter(a.frame)
        const to = frameCenter(b.frame)
        const path = ropePath(from, to)
        if (!path) return null

        const highlight = selectedId === a.id || selectedId === b.id
        const stroke = CONNECTION_STROKE[conn.kind]

        return (
          <path
            key={conn.id}
            d={path}
            fill="none"
            stroke={stroke}
            strokeWidth={highlight ? 3 : 2}
            strokeLinecap="round"
            strokeDasharray={conn.status === 'error' ? '6 4' : undefined}
            opacity={highlight ? 0.95 : 0.55}
          />
        )
      })}
    </svg>
  )
}
