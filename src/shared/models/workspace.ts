/**
 * `workspace.json` — schemaVersion 2, compatível com open-maestri v0.25.4.
 *
 * Estrutura exata (ver WorkspaceDocument.swift + WorkspacePayload.swift):
 *
 * ```json
 * { "schemaVersion": 2, "type": "workspace", "payload": { ... } }
 * ```
 *
 * Regras de escrita:
 * - datas ISO8601 sem fração de segundo
 * - UUIDs em MAIÚSCULO
 * - opcionais ausentes são OMITIDOS (nunca `null`)
 * - `frame` sempre `[[x,y],[w,h]]`
 */

import { CANVAS_INITIAL_ORIGIN, SCHEMA_VERSION } from '../constants'
import {
  asRecord,
  decodeDateOptional,
  encodeDate,
  optionalUuid,
  readArray,
  readBool,
  readNumber,
  readOptionalString,
  readString,
  requireUuid,
} from './codec'
import {
  frameFromArray,
  frameToArray,
  pointFromArray,
  pointToArray,
  pointsFromArray,
  type Frame,
  type Point,
} from './geometry'
import {
  decodeNodeContent,
  encodeNodeContent,
  type AgentType,
  type NodeContent,
  type NodeContentType,
} from './node-content'

// ---------------------------------------------------------------------------
// CanvasNode
// ---------------------------------------------------------------------------

export interface CanvasNode {
  id: string
  frame: Frame
  content: NodeContent
  zIndex: number
  isLocked: boolean
  createdAt: Date
  lastModifiedAt: Date
}

export function encodeCanvasNode(node: CanvasNode): Record<string, unknown> {
  return {
    id: node.id,
    frame: frameToArray(node.frame),
    content: encodeNodeContent(node.content),
    zIndex: node.zIndex,
    isLocked: node.isLocked,
    createdAt: encodeDate(node.createdAt),
    lastModifiedAt: encodeDate(node.lastModifiedAt),
  }
}

/**
 * Lê um nó. Retorna `undefined` quando o nó é de um tipo desconhecido ou está
 * corrompido — descartar um nó é preferível a não abrir o workspace.
 */
export function decodeCanvasNode(value: unknown): CanvasNode | undefined {
  try {
    const o = asRecord(value, 'node')
    const frame = frameFromArray(o.frame)
    if (!frame) return undefined
    const content = decodeNodeContent(o.content)
    if (!content) return undefined
    return {
      id: requireUuid(o.id, 'node.id'),
      frame,
      content,
      zIndex: readNumber(o, 'zIndex', 0),
      isLocked: readBool(o, 'isLocked', false),
      createdAt: decodeDateOptional(o.createdAt) ?? new Date(),
      lastModifiedAt: decodeDateOptional(o.lastModifiedAt) ?? new Date(),
    }
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Conexões
// ---------------------------------------------------------------------------

export interface TerminalConnection {
  id: string
  createdAt: Date
  terminalIdA: string
  terminalIdB: string
  ropePoints: Point[]
}

export interface NoteConnection {
  id: string
  createdAt: Date
  terminalId: string
  noteNodeId: string
  ropePoints: Point[]
}

export interface PortalConnection {
  id: string
  createdAt: Date
  terminalId: string
  portalNodeId: string
  ropePoints: Point[]
}

export interface PortalToPortalConnection {
  id: string
  createdAt: Date
  portalIdA: string
  portalIdB: string
  ropePoints: Point[]
}

export interface NoteToNoteConnection {
  id: string
  createdAt: Date
  noteNodeIdA: string
  noteNodeIdB: string
  ropePoints: Point[]
}

export interface CrossFloorConnection {
  id: string
  createdAt: Date
  nodeIdA: string
  floorIdA?: string
  nodeIdB: string
  floorIdB?: string
  ropePoints: Point[]
}

function encodeRopePoints(points: Point[]): [number, number][] {
  return points.map((p) => [p.x, p.y])
}

export function encodeTerminalConnection(c: TerminalConnection): Record<string, unknown> {
  return {
    id: c.id,
    createdAt: encodeDate(c.createdAt),
    terminalIdA: c.terminalIdA,
    terminalIdB: c.terminalIdB,
    ropePoints: encodeRopePoints(c.ropePoints),
  }
}

export function encodeNoteConnection(c: NoteConnection): Record<string, unknown> {
  return {
    id: c.id,
    createdAt: encodeDate(c.createdAt),
    terminalId: c.terminalId,
    noteNodeId: c.noteNodeId,
    ropePoints: encodeRopePoints(c.ropePoints),
  }
}

export function encodePortalConnection(c: PortalConnection): Record<string, unknown> {
  return {
    id: c.id,
    createdAt: encodeDate(c.createdAt),
    terminalId: c.terminalId,
    portalNodeId: c.portalNodeId,
    ropePoints: encodeRopePoints(c.ropePoints),
  }
}

export function encodePortalToPortalConnection(c: PortalToPortalConnection): Record<string, unknown> {
  return {
    id: c.id,
    createdAt: encodeDate(c.createdAt),
    portalIdA: c.portalIdA,
    portalIdB: c.portalIdB,
    ropePoints: encodeRopePoints(c.ropePoints),
  }
}

export function encodeNoteToNoteConnection(c: NoteToNoteConnection): Record<string, unknown> {
  return {
    id: c.id,
    createdAt: encodeDate(c.createdAt),
    noteNodeIdA: c.noteNodeIdA,
    noteNodeIdB: c.noteNodeIdB,
    ropePoints: encodeRopePoints(c.ropePoints),
  }
}

export function encodeCrossFloorConnection(c: CrossFloorConnection): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: c.id,
    createdAt: encodeDate(c.createdAt),
    nodeIdA: c.nodeIdA,
    nodeIdB: c.nodeIdB,
    ropePoints: encodeRopePoints(c.ropePoints),
  }
  if (c.floorIdA !== undefined) out.floorIdA = c.floorIdA
  if (c.floorIdB !== undefined) out.floorIdB = c.floorIdB
  return out
}

function decodeBase(value: unknown): { id: string; createdAt: Date; ropePoints: Point[] } {
  const o = asRecord(value, 'connection')
  return {
    id: requireUuid(o.id, 'connection.id'),
    createdAt: decodeDateOptional(o.createdAt) ?? new Date(),
    ropePoints: pointsFromArray(readArray(o, 'ropePoints')),
  }
}

function decodeConnectionList<T>(value: unknown, decode: (raw: unknown) => T | undefined): T[] {
  const out: T[] = []
  for (const entry of readArray({ items: value }, 'items')) {
    const decoded = decode(entry)
    if (decoded !== undefined) out.push(decoded)
  }
  return out
}

export function decodeTerminalConnection(value: unknown): TerminalConnection | undefined {
  try {
    const o = asRecord(value, 'terminalConnection')
    const base = decodeBase(value)
    return {
      ...base,
      terminalIdA: requireUuid(o.terminalIdA, 'terminalIdA'),
      terminalIdB: requireUuid(o.terminalIdB, 'terminalIdB'),
    }
  } catch {
    return undefined
  }
}

export function decodeNoteConnection(value: unknown): NoteConnection | undefined {
  try {
    const o = asRecord(value, 'noteConnection')
    const base = decodeBase(value)
    return {
      ...base,
      terminalId: requireUuid(o.terminalId, 'terminalId'),
      noteNodeId: requireUuid(o.noteNodeId, 'noteNodeId'),
    }
  } catch {
    return undefined
  }
}

export function decodePortalConnection(value: unknown): PortalConnection | undefined {
  try {
    const o = asRecord(value, 'portalConnection')
    const base = decodeBase(value)
    return {
      ...base,
      terminalId: requireUuid(o.terminalId, 'terminalId'),
      portalNodeId: requireUuid(o.portalNodeId, 'portalNodeId'),
    }
  } catch {
    return undefined
  }
}

export function decodePortalToPortalConnection(value: unknown): PortalToPortalConnection | undefined {
  try {
    const o = asRecord(value, 'portalToPortalConnection')
    const base = decodeBase(value)
    return {
      ...base,
      portalIdA: requireUuid(o.portalIdA, 'portalIdA'),
      portalIdB: requireUuid(o.portalIdB, 'portalIdB'),
    }
  } catch {
    return undefined
  }
}

export function decodeNoteToNoteConnection(value: unknown): NoteToNoteConnection | undefined {
  try {
    const o = asRecord(value, 'noteToNoteConnection')
    const base = decodeBase(value)
    return {
      ...base,
      noteNodeIdA: requireUuid(o.noteNodeIdA, 'noteNodeIdA'),
      noteNodeIdB: requireUuid(o.noteNodeIdB, 'noteNodeIdB'),
    }
  } catch {
    return undefined
  }
}

export function decodeCrossFloorConnection(value: unknown): CrossFloorConnection | undefined {
  try {
    const o = asRecord(value, 'crossFloorConnection')
    const base = decodeBase(value)
    const conn: CrossFloorConnection = {
      ...base,
      nodeIdA: requireUuid(o.nodeIdA, 'nodeIdA'),
      nodeIdB: requireUuid(o.nodeIdB, 'nodeIdB'),
    }
    const floorIdA = optionalUuid(o.floorIdA, 'floorIdA')
    if (floorIdA !== undefined) conn.floorIdA = floorIdA
    const floorIdB = optionalUuid(o.floorIdB, 'floorIdB')
    if (floorIdB !== undefined) conn.floorIdB = floorIdB
    return conn
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Floors e drawings
// ---------------------------------------------------------------------------

export interface FloorHooks {
  onCreate?: string
  onLand?: string
  onDismiss?: string
}

export interface FloorEntry {
  id: string
  name: string
  branchName: string
  worktreePath: string
  hooks: FloorHooks
  createdAt: Date
}

export interface Drawing {
  id: string
  points: Point[]
  color: string
  lineWidth: number
  createdAt: Date
}

function encodeHooks(hooks: FloorHooks): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (hooks.onCreate !== undefined) out.onCreate = hooks.onCreate
  if (hooks.onLand !== undefined) out.onLand = hooks.onLand
  if (hooks.onDismiss !== undefined) out.onDismiss = hooks.onDismiss
  return out
}

function decodeHooks(value: unknown): FloorHooks {
  if (typeof value !== 'object' || value === null) return {}
  const o = value as Record<string, unknown>
  const hooks: FloorHooks = {}
  const onCreate = readOptionalString(o, 'onCreate')
  if (onCreate !== undefined) hooks.onCreate = onCreate
  const onLand = readOptionalString(o, 'onLand')
  if (onLand !== undefined) hooks.onLand = onLand
  const onDismiss = readOptionalString(o, 'onDismiss')
  if (onDismiss !== undefined) hooks.onDismiss = onDismiss
  return hooks
}

export function encodeFloorEntry(f: FloorEntry): Record<string, unknown> {
  return {
    id: f.id,
    name: f.name,
    branchName: f.branchName,
    worktreePath: f.worktreePath,
    hooks: encodeHooks(f.hooks),
    createdAt: encodeDate(f.createdAt),
  }
}

export function decodeFloorEntry(value: unknown): FloorEntry | undefined {
  try {
    const o = asRecord(value, 'floor')
    return {
      id: requireUuid(o.id, 'floor.id'),
      name: readString(o, 'name', ''),
      branchName: readString(o, 'branchName', ''),
      worktreePath: readString(o, 'worktreePath', ''),
      hooks: decodeHooks(o.hooks),
      createdAt: decodeDateOptional(o.createdAt) ?? new Date(),
    }
  } catch {
    return undefined
  }
}

export function encodeDrawing(d: Drawing): Record<string, unknown> {
  return {
    id: d.id,
    points: encodeRopePoints(d.points),
    color: d.color,
    lineWidth: d.lineWidth,
    createdAt: encodeDate(d.createdAt),
  }
}

export function decodeDrawing(value: unknown): Drawing | undefined {
  try {
    const o = asRecord(value, 'drawing')
    return {
      id: requireUuid(o.id, 'drawing.id'),
      points: pointsFromArray(readArray(o, 'points')),
      color: readString(o, 'color', '#000000'),
      lineWidth: readNumber(o, 'lineWidth', 2),
      createdAt: decodeDateOptional(o.createdAt) ?? new Date(),
    }
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// WorkspacePayload
// ---------------------------------------------------------------------------

export type LocationType = 'local' | 'ssh'
export type PreferredIDE = 'cursor' | 'vscode' | 'xcode'

export interface WorkspacePayload {
  id: string
  name: string
  icon: string
  isPinned: boolean
  locationType: LocationType
  workingDirectory: string
  preferredIDE: PreferredIDE
  syncConfigFiles: boolean

  canvasOrigin: Point
  canvasZoom: number

  nodes: CanvasNode[]
  connections: TerminalConnection[]
  noteConnections: NoteConnection[]
  portalConnections: PortalConnection[]
  portalToPortalConnections: PortalToPortalConnection[]
  noteToNoteConnections: NoteToNoteConnection[]
  crossFloorConnections: CrossFloorConnection[]
  floors: FloorEntry[]
  drawings: Drawing[]

  createdAt: Date
  lastOpenedAt?: Date
  lastModifiedAt: Date
}

export interface WorkspaceDocument {
  schemaVersion: number
  type: 'workspace'
  payload: WorkspacePayload
}

/** Conjuntos de nós válidos, para reconciliar conexões órfãs ao carregar. */
export function nodeIdsByType(payload: WorkspacePayload, type: NodeContentType): Set<string> {
  const ids = new Set<string>()
  for (const node of payload.nodes) {
    if (node.content.type !== type) continue
    if (node.content.type === 'terminal' || node.content.type === 'portal') ids.add(node.content.value.id)
    else ids.add(node.id)
  }
  return ids
}

/**
 * `canvasOrigin` e um `CGPoint` no Swift, e `CGPoint` codifica como **array**
 * `[x, y]` — nao como `{x, y}`. O fixture escrito a mao em
 * `Tests/OpenMaestriTests/Fixtures/TestWorkspace.json` usa objeto, mas nenhum
 * teste o le; o encoder real do Darwin emite array.
 *
 * Aqui aceitamos os dois formatos na leitura e sempre gravamos array, para que
 * o macOS consiga ler o que escrevemos.
 */
export function decodeCanvasOrigin(value: unknown): Point {
  if (Array.isArray(value)) {
    const point = pointFromArray(value)
    if (point) return point
  }
  if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>
    const x = typeof o.x === 'number' ? o.x : undefined
    const y = typeof o.y === 'number' ? o.y : undefined
    if (x !== undefined && y !== undefined) return { x, y }
  }
  return { ...CANVAS_INITIAL_ORIGIN }
}

export function decodeWorkspaceDocument(raw: unknown): WorkspaceDocument {
  const o = asRecord(raw, 'workspace')

  const migrated = migrateWorkspacePayload(raw)
  const payloadRaw = asRecord(migrated.payload ?? migrated, 'workspace.payload')

  const nodes = readArray(payloadRaw, 'nodes')
    .map(decodeCanvasNode)
    .filter((n): n is CanvasNode => n !== undefined)

  const connections = decodeConnectionList(payloadRaw.connections, decodeTerminalConnection)
  const noteConnections = decodeConnectionList(payloadRaw.noteConnections, decodeNoteConnection)
  const portalConnections = decodeConnectionList(payloadRaw.portalConnections, decodePortalConnection)
  const portalToPortalConnections = decodeConnectionList(
    payloadRaw.portalToPortalConnections,
    decodePortalToPortalConnection,
  )
  const noteToNoteConnections = decodeConnectionList(payloadRaw.noteToNoteConnections, decodeNoteToNoteConnection)
  const crossFloorConnections = decodeConnectionList(payloadRaw.crossFloorConnections, decodeCrossFloorConnection)
  const floors = readArray(payloadRaw, 'floors')
    .map(decodeFloorEntry)
    .filter((f): f is FloorEntry => f !== undefined)
  const drawings = readArray(payloadRaw, 'drawings')
    .map(decodeDrawing)
    .filter((d): d is Drawing => d !== undefined)

  const canvasOrigin = decodeCanvasOrigin(payloadRaw.canvasOrigin)

  const locationType: LocationType = payloadRaw.locationType === 'ssh' ? 'ssh' : 'local'
  const preferredIDE = payloadRaw.preferredIDE
  const ide: PreferredIDE =
    preferredIDE === 'vscode' || preferredIDE === 'xcode' ? preferredIDE : 'cursor'

  const payload: WorkspacePayload = {
    id: requireUuid(payloadRaw.id, 'workspace.id'),
    name: readString(payloadRaw, 'name', 'Workspace'),
    icon: readString(payloadRaw, 'icon', 'folder'),
    isPinned: readBool(payloadRaw, 'isPinned', false),
    locationType,
    workingDirectory: readString(payloadRaw, 'workingDirectory', ''),
    preferredIDE: ide,
    syncConfigFiles: readBool(payloadRaw, 'syncConfigFiles', false),
    canvasOrigin,
    canvasZoom: readNumber(payloadRaw, 'canvasZoom', 1.0),
    nodes,
    connections,
    noteConnections,
    portalConnections,
    portalToPortalConnections,
    noteToNoteConnections,
    crossFloorConnections,
    floors,
    drawings,
    createdAt:
      decodeDateOptional(payloadRaw.createdAt) ?? decodeDateOptional(o.createdAt) ?? new Date(),
    lastModifiedAt: decodeDateOptional(payloadRaw.lastModifiedAt) ?? new Date(),
  }

  const lastOpenedAt = decodeDateOptional(payloadRaw.lastOpenedAt)
  if (lastOpenedAt !== undefined) payload.lastOpenedAt = lastOpenedAt

  const schemaVersion =
    typeof o.schemaVersion === 'number' ? o.schemaVersion : readNumber(payloadRaw, 'schemaVersion', SCHEMA_VERSION)

  return { schemaVersion, type: 'workspace', payload }
}

export function encodeWorkspaceDocument(doc: WorkspaceDocument): Record<string, unknown> {
  const p = doc.payload
  const payload: Record<string, unknown> = {
    id: p.id,
    name: p.name,
    icon: p.icon,
    isPinned: p.isPinned,
    locationType: p.locationType,
    workingDirectory: p.workingDirectory,
    preferredIDE: p.preferredIDE,
    syncConfigFiles: p.syncConfigFiles,
    canvasOrigin: pointToArray(p.canvasOrigin),
    canvasZoom: p.canvasZoom,
    nodes: p.nodes.map(encodeCanvasNode),
    connections: p.connections.map(encodeTerminalConnection),
    noteConnections: p.noteConnections.map(encodeNoteConnection),
    portalConnections: p.portalConnections.map(encodePortalConnection),
    portalToPortalConnections: p.portalToPortalConnections.map(encodePortalToPortalConnection),
    noteToNoteConnections: p.noteToNoteConnections.map(encodeNoteConnectionRow),
    crossFloorConnections: p.crossFloorConnections.map(encodeCrossFloorConnection),
    floors: p.floors.map(encodeFloorEntry),
    drawings: p.drawings.map(encodeDrawing),
    createdAt: encodeDate(p.createdAt),
    lastModifiedAt: encodeDate(p.lastModifiedAt),
  }
  if (p.lastOpenedAt !== undefined) payload.lastOpenedAt = encodeDate(p.lastOpenedAt)

  return { schemaVersion: doc.schemaVersion, type: doc.type, payload }
}

function encodeNoteConnectionRow(c: NoteToNoteConnection): Record<string, unknown> {
  return encodeNoteToNoteConnection(c)
}

// ---------------------------------------------------------------------------
// Migracao
// ---------------------------------------------------------------------------

/**
 * Compatibilidade de leitura. O macOS v1 nao tinha o envelope `payload` nem
 * todos os arrays de conexao; normalizamos para v2 em memoria.
 */
export function migrateWorkspacePayload(raw: unknown): Record<string, unknown> {
  const o = asRecord(raw, 'workspace')
  const hasPayload = typeof o.payload === 'object' && o.payload !== null
  const payload = hasPayload ? (o.payload as Record<string, unknown>) : o

  const normalized: Record<string, unknown> = { ...payload }
  for (const key of [
    'nodes',
    'connections',
    'noteConnections',
    'portalConnections',
    'portalToPortalConnections',
    'noteToNoteConnections',
    'crossFloorConnections',
    'floors',
    'drawings',
  ]) {
    if (!Array.isArray(normalized[key])) normalized[key] = []
  }
  normalized.canvasOrigin = pointToArray(decodeCanvasOrigin(normalized.canvasOrigin))
  if (typeof normalized.canvasZoom !== 'number') normalized.canvasZoom = 1.0
  if (typeof normalized.icon !== 'string') normalized.icon = 'folder'
  if (typeof normalized.isPinned !== 'boolean') normalized.isPinned = false
  if (typeof normalized.syncConfigFiles !== 'boolean') normalized.syncConfigFiles = false
  if (typeof normalized.locationType !== 'string') normalized.locationType = 'local'
  if (typeof normalized.preferredIDE !== 'string') normalized.preferredIDE = 'cursor'

  return { ...o, payload: normalized }
}

// ---------------------------------------------------------------------------
// Fabrica
// ---------------------------------------------------------------------------

export function createWorkspacePayload(id: string, name: string, workingDirectory: string): WorkspacePayload {
  const now = new Date()
  return {
    id,
    name,
    icon: 'folder',
    isPinned: false,
    locationType: 'local',
    workingDirectory,
    preferredIDE: 'cursor',
    syncConfigFiles: false,
    canvasOrigin: { ...CANVAS_INITIAL_ORIGIN },
    canvasZoom: 1.0,
    nodes: [],
    connections: [],
    noteConnections: [],
    portalConnections: [],
    portalToPortalConnections: [],
    noteToNoteConnections: [],
    crossFloorConnections: [],
    floors: [],
    drawings: [],
    createdAt: now,
    lastModifiedAt: now,
  }
}

export function createWorkspaceDocument(payload: WorkspacePayload): WorkspaceDocument {
  return { schemaVersion: SCHEMA_VERSION, type: 'workspace', payload }
}

/** Nó auxiliar para criação. */
export function createCanvasNode(id: string, frame: Frame, content: NodeContent, zIndex = 0): CanvasNode {
  const now = new Date()
  return { id, frame, content, zIndex, isLocked: false, createdAt: now, lastModifiedAt: now }
}

export type { AgentType }
