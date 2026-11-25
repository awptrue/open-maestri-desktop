/**
 * NodeContent — os 8 tipos de conteudo de no do open-maestri.
 *
 * CONTRATO CRITICO (ver NodeContent.swift e Migration/CLAUDE.md):
 * todo caso serializa como `{ "<tipo>": { "_0": { ...campos } } }`.
 * Sem esse envelope o open-maestri do macOS nao le o arquivo.
 */

import {
  asRecord,
  decodeDateOptional,
  encodeDate,
  newId,
  optionalUuid,
  requireUuid,
  readArray,
  readBool,
  readNumber,
  readOptionalNumber,
  readOptionalString,
  readString,
} from './codec'
import { pointFromArray, pointToArray, pointsFromArray, type Point } from './geometry'

// ---------------------------------------------------------------------------
// Enums de valor
// ---------------------------------------------------------------------------

export type AgentType = 'claude_code' | 'codex' | 'gemini_cli' | 'open_code' | 'generic_shell'
export type TerminalStatus = 'running' | 'idle'

export type ShortcutKind =
  | 'automatic'
  | 'none'
  | 'cmd1'
  | 'cmd2'
  | 'cmd3'
  | 'cmd4'
  | 'cmd5'
  | 'cmd6'
  | 'cmd7'
  | 'cmd8'
  | 'cmd9'

export type StorageScope = 'isolated' | 'shared'
export type FileTreeViewMode = 'list' | 'grid'
export type TextAlignment = 'left' | 'center' | 'right'
export type TextFontWeight = 'regular' | 'medium' | 'bold'
export type ShapeType = 'rect' | 'ellipse' | 'diamond'
export type ShapeStrokeStyle = 'solid' | 'dashed' | 'dotted'
export type ShapeFillStyle = 'solid' | 'none' | 'hatched' | 'crossHatched'
export type StrokeType = 'line' | 'arrow'
export type FreehandType = 'pen' | 'highlighter'

// ---------------------------------------------------------------------------
// Conteudos
// ---------------------------------------------------------------------------

export interface TerminalContent {
  agentType: AgentType
  command: string
  name: string
  icon: string
  color: string
  id: string
  shellPath: string
  workingDirectory: string
  status: TerminalStatus
  isManager: boolean
  monitorWithOmbro: boolean
  autoScrollLocked: boolean
  shortcutMode: { kind: ShortcutKind }
  assignedRoleId?: string
  scrollbackFile?: string
  scrollbackLineCount: number
  lastActiveAt?: Date
  themeId?: string
  fontFamily?: string
  fontSize?: number
}

/** `storageMode` e um enum Swift com payload: `{"managed": {}}` ou `{"custom": {"_0": "path"}}`. */
export type StickyNoteStorageMode = { managed: Record<string, never> } | { custom: string }

export interface StickyNoteContent {
  color: string
  fileName?: string
  fontSize: number
  hasCustomName: boolean
  isPreviewing: boolean
  storageMode: StickyNoteStorageMode
}

/** `source` e `{"none": ...}` implicito (chave ausente) ou `{"url": {"_0": "https://..."}}`. */
export type PortalSource = { none: true } | { url: string }

export interface PortalContent {
  id: string
  name: string
  currentURL: string
  source: PortalSource
  status: string
  chromeHidden: boolean
  storageScope: StorageScope
}

export interface FileTreeContent {
  name: string
  rootPath: string
  viewMode: FileTreeViewMode
}

export interface TextContent {
  text: string
  fontSize: number
  fontWeight: TextFontWeight
  color: string
  alignment: TextAlignment
  fontFamily: string
}

export interface ShapeContent {
  shapeType: ShapeType
  fillColor: string
  strokeColor: string
  strokeWidth: number
  strokeStyle: ShapeStrokeStyle
  fillStyle: ShapeFillStyle
  text: string
  fontSize: number
  rotation: number
}

export interface StrokeContent {
  strokeType: StrokeType
  startPoint: Point
  endPoint: Point
  controlPoint?: Point
  strokeColor: string
  strokeWidth: number
  strokeStyle: ShapeStrokeStyle
}

export interface FreehandContent {
  freehandType: FreehandType
  points: Point[]
  strokeColor: string
  strokeWidth: number
  opacity: number
  rotation: number
}

export type NodeContent =
  | { type: 'terminal'; value: TerminalContent }
  | { type: 'stickyNote'; value: StickyNoteContent }
  | { type: 'portal'; value: PortalContent }
  | { type: 'fileTree'; value: FileTreeContent }
  | { type: 'text'; value: TextContent }
  | { type: 'shape'; value: ShapeContent }
  | { type: 'stroke'; value: StrokeContent }
  | { type: 'freehand'; value: FreehandContent }

export type NodeContentType = NodeContent['type']

/** Tipos que aceitam conexao (ver `NodeContent.isConnectable` no Swift). */
export const CONNECTABLE_TYPES: ReadonlySet<NodeContentType> = new Set(['terminal', 'stickyNote', 'portal'])

export function isConnectable(content: NodeContent): boolean {
  return CONNECTABLE_TYPES.has(content.type)
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Envelopa um conteudo no formato Maestri `{ "<tipo>": { "_0": ... } }`. */
export function encodeNodeContent(content: NodeContent): Record<string, unknown> {
  return { [content.type]: { _0: encodeInner(content) } }
}

function encodeInner(content: NodeContent): Record<string, unknown> {
  switch (content.type) {
    case 'terminal':
      return encodeTerminal(content.value)
    case 'stickyNote':
      return encodeStickyNote(content.value)
    case 'portal':
      return encodePortal(content.value)
    case 'fileTree':
      return encodeFileTree(content.value)
    case 'text':
      return encodeText(content.value)
    case 'shape':
      return encodeShape(content.value)
    case 'stroke':
      return encodeStroke(content.value)
    case 'freehand':
      return encodeFreehand(content.value)
  }
}

/**
 * Campos opcionais sao OMITIDOS quando ausentes (equivalente a `encodeIfPresent`).
 * Nunca gravamos `null`.
 */
function encodeTerminal(t: TerminalContent): Record<string, unknown> {
  const out: Record<string, unknown> = {
    agentType: t.agentType,
    command: t.command,
    name: t.name,
    icon: t.icon,
    color: t.color,
    id: t.id,
    shellPath: t.shellPath,
    workingDirectory: t.workingDirectory,
    status: t.status,
    isManager: t.isManager,
    monitorWithOmbro: t.monitorWithOmbro,
    autoScrollLocked: t.autoScrollLocked,
    shortcutMode: { kind: t.shortcutMode.kind },
    scrollbackLineCount: t.scrollbackLineCount,
  }
  if (t.assignedRoleId !== undefined) out.assignedRoleId = t.assignedRoleId
  if (t.scrollbackFile !== undefined) out.scrollbackFile = t.scrollbackFile
  if (t.lastActiveAt !== undefined) out.lastActiveAt = encodeDate(t.lastActiveAt)
  if (t.themeId !== undefined) out.themeId = t.themeId
  if (t.fontFamily !== undefined) out.fontFamily = t.fontFamily
  if (t.fontSize !== undefined) out.fontSize = t.fontSize
  return out
}

export function encodeStickyNoteStorageMode(mode: StickyNoteStorageMode): Record<string, unknown> {
  if ('managed' in mode) return { managed: {} }
  return { custom: { _0: mode.custom } }
}

function encodeStickyNote(n: StickyNoteContent): Record<string, unknown> {
  const out: Record<string, unknown> = {
    color: n.color,
    fontSize: n.fontSize,
    hasCustomName: n.hasCustomName,
    isPreviewing: n.isPreviewing,
    storageMode: encodeStickyNoteStorageMode(n.storageMode),
  }
  if (n.fileName !== undefined) out.fileName = n.fileName
  return out
}

export function encodePortalSource(source: PortalSource): Record<string, unknown> {
  if ('url' in source) return { url: { _0: source.url } }
  return {}
}

function encodePortal(p: PortalContent): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    currentURL: p.currentURL,
    source: encodePortalSource(p.source),
    status: p.status,
    chromeHidden: p.chromeHidden,
    storageScope: p.storageScope,
  }
}

function encodeFileTree(f: FileTreeContent): Record<string, unknown> {
  return { name: f.name, rootPath: f.rootPath, viewMode: f.viewMode }
}

function encodeText(t: TextContent): Record<string, unknown> {
  return {
    text: t.text,
    fontSize: t.fontSize,
    fontWeight: t.fontWeight,
    color: t.color,
    alignment: t.alignment,
    fontFamily: t.fontFamily,
  }
}

function encodeShape(s: ShapeContent): Record<string, unknown> {
  return {
    shapeType: s.shapeType,
    fillColor: s.fillColor,
    strokeColor: s.strokeColor,
    strokeWidth: s.strokeWidth,
    strokeStyle: s.strokeStyle,
    fillStyle: s.fillStyle,
    text: s.text,
    fontSize: s.fontSize,
    rotation: s.rotation,
  }
}

function encodeStroke(s: StrokeContent): Record<string, unknown> {
  const out: Record<string, unknown> = {
    strokeType: s.strokeType,
    startPoint: pointToArray(s.startPoint),
    endPoint: pointToArray(s.endPoint),
    strokeColor: s.strokeColor,
    strokeWidth: s.strokeWidth,
    strokeStyle: s.strokeStyle,
  }
  if (s.controlPoint !== undefined) out.controlPoint = pointToArray(s.controlPoint)
  return out
}

function encodeFreehand(f: FreehandContent): Record<string, unknown> {
  return {
    freehandType: f.freehandType,
    points: f.points.map(pointToArray),
    strokeColor: f.strokeColor,
    strokeWidth: f.strokeWidth,
    opacity: f.opacity,
    rotation: f.rotation,
  }
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

const CONTENT_TYPES: NodeContentType[] = [
  'terminal',
  'stickyNote',
  'portal',
  'fileTree',
  'text',
  'shape',
  'stroke',
  'freehand',
]

/**
 * Le `{ "<tipo>": { "_0": ... } }`. Tipos desconhecidos sao retornados como
 * `undefined` para que o chamador decida descartar (nao lancamos excecao: um
 * workspace do futuro nao deve quebrar a abertura do arquivo inteiro).
 */
export function decodeNodeContent(value: unknown): NodeContent | undefined {
  const record = asRecord(value, 'content')
  const found = CONTENT_TYPES.find((t) => Object.prototype.hasOwnProperty.call(record, t))
  if (!found) return undefined
  const outer = asRecord(record[found], `content.${found}`)
  const hasInner = Object.prototype.hasOwnProperty.call(outer, '_0')
  // `storageMode: {managed:{}}` tem envelope proprio e e tratado dentro do tipo.
  const inner = hasInner ? outer._0 : outer

  try {
    return decodeInner(found, inner)
  } catch {
    return undefined
  }
}

function decodeInner(type: NodeContentType, inner: unknown): NodeContent {
  switch (type) {
    case 'terminal':
      return { type, value: decodeTerminal(inner) }
    case 'stickyNote':
      return { type, value: decodeStickyNote(inner) }
    case 'portal':
      return { type, value: decodePortal(inner) }
    case 'fileTree':
      return { type, value: decodeFileTree(inner) }
    case 'text':
      return { type, value: decodeText(inner) }
    case 'shape':
      return { type, value: decodeShape(inner) }
    case 'stroke':
      return { type, value: decodeStroke(inner) }
    case 'freehand':
      return { type, value: decodeFreehand(inner) }
  }
}

function decodeAgentType(v: unknown): AgentType {
  const allowed: AgentType[] = ['claude_code', 'codex', 'gemini_cli', 'open_code', 'generic_shell']
  return allowed.includes(v as AgentType) ? (v as AgentType) : 'generic_shell'
}

function decodeShortcutKind(v: unknown): ShortcutKind {
  const allowed: ShortcutKind[] = [
    'automatic',
    'none',
    'cmd1',
    'cmd2',
    'cmd3',
    'cmd4',
    'cmd5',
    'cmd6',
    'cmd7',
    'cmd8',
    'cmd9',
  ]
  return allowed.includes(v as ShortcutKind) ? (v as ShortcutKind) : 'automatic'
}

function decodeTerminal(inner: unknown): TerminalContent {
  const o = asRecord(inner, 'terminal')
  const shortcut = o.shortcutMode
  const shortcutKind =
    typeof shortcut === 'object' && shortcut !== null
      ? decodeShortcutKind((shortcut as Record<string, unknown>).kind)
      : decodeShortcutKind(undefined)

  const content: TerminalContent = {
    agentType: decodeAgentType(o.agentType),
    command: readString(o, 'command', ''),
    name: readString(o, 'name', 'Terminal'),
    icon: readString(o, 'icon', 'terminal'),
    color: readString(o, 'color', '#007AFF'),
    id: requireUuid(o.id, 'terminal.id'),
    shellPath: readString(o, 'shellPath', ''),
    workingDirectory: readString(o, 'workingDirectory', ''),
    status: o.status === 'running' ? 'running' : 'idle',
    isManager: readBool(o, 'isManager', false),
    monitorWithOmbro: readBool(o, 'monitorWithOmbro', false),
    autoScrollLocked: readBool(o, 'autoScrollLocked', false),
    shortcutMode: { kind: shortcutKind },
    scrollbackLineCount: readNumber(o, 'scrollbackLineCount', 0),
  }

  const assignedRoleId = optionalUuid(o.assignedRoleId, 'terminal.assignedRoleId')
  if (assignedRoleId !== undefined) content.assignedRoleId = assignedRoleId
  const scrollbackFile = readOptionalString(o, 'scrollbackFile')
  if (scrollbackFile !== undefined) content.scrollbackFile = scrollbackFile
  const lastActiveAt = decodeDateOptional(o.lastActiveAt)
  if (lastActiveAt !== undefined) content.lastActiveAt = lastActiveAt
  const themeId = readOptionalString(o, 'themeId')
  if (themeId !== undefined) content.themeId = themeId
  const fontFamily = readOptionalString(o, 'fontFamily')
  if (fontFamily !== undefined) content.fontFamily = fontFamily
  const fontSize = readOptionalNumber(o, 'fontSize')
  if (fontSize !== undefined) content.fontSize = fontSize

  return content
}

function decodeStorageMode(v: unknown): StickyNoteStorageMode {
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>
    if (Object.prototype.hasOwnProperty.call(o, 'custom')) {
      const custom = o.custom
      if (typeof custom === 'object' && custom !== null) {
        const path = (custom as Record<string, unknown>)._0
        if (typeof path === 'string') return { custom: path }
      }
      if (typeof custom === 'string') return { custom }
    }
  }
  return { managed: {} }
}

function decodeStickyNote(inner: unknown): StickyNoteContent {
  const o = asRecord(inner, 'stickyNote')
  const note: StickyNoteContent = {
    color: readString(o, 'color', '#FEFDE8'),
    fontSize: readNumber(o, 'fontSize', 14),
    hasCustomName: readBool(o, 'hasCustomName', false),
    isPreviewing: readBool(o, 'isPreviewing', false),
    storageMode: decodeStorageMode(o.storageMode),
  }
  const fileName = readOptionalString(o, 'fileName')
  if (fileName !== undefined) note.fileName = fileName
  return note
}

function decodePortalSource(v: unknown, currentURL: string): PortalSource {
  // `source` ausente e o caso `.none` implicito do Swift. Mas um `{}` EXPLICITO
  // tambem significa `.none` — nao podemos "adivinhar" pela currentURL, senao o
  // round-trip muda o campo e o macOS passa a ver uma URL que nao estava la.
  if (v === undefined || v === null) {
    return currentURL ? { url: currentURL } : { none: true }
  }
  if (typeof v === 'object') {
    const url = (v as Record<string, unknown>).url
    if (typeof url === 'object' && url !== null) {
      const inner = (url as Record<string, unknown>)._0
      if (typeof inner === 'string') return { url: inner }
    }
    if (typeof url === 'string') return { url }
    return { none: true }
  }
  return { none: true }
}

function decodePortal(inner: unknown): PortalContent {
  const o = asRecord(inner, 'portal')
  const currentURL = readString(o, 'currentURL', '')
  return {
    id: requireUuid(o.id, 'portal.id'),
    name: readString(o, 'name', 'Portal'),
    currentURL,
    source: decodePortalSource(o.source, currentURL),
    status: readString(o, 'status', 'idle'),
    chromeHidden: readBool(o, 'chromeHidden', false),
    storageScope: o.storageScope === 'shared' ? 'shared' : 'isolated',
  }
}

function decodeFileTree(inner: unknown): FileTreeContent {
  const o = asRecord(inner, 'fileTree')
  return {
    name: readString(o, 'name', 'Files'),
    rootPath: readString(o, 'rootPath', ''),
    viewMode: o.viewMode === 'grid' ? 'grid' : 'list',
  }
}

function decodeText(inner: unknown): TextContent {
  const o = asRecord(inner, 'text')
  const alignment = o.alignment
  const weight = o.fontWeight
  return {
    text: readString(o, 'text', ''),
    fontSize: readNumber(o, 'fontSize', 18),
    fontWeight: weight === 'medium' || weight === 'bold' ? weight : 'regular',
    color: readString(o, 'color', '#1a1a1a'),
    alignment: alignment === 'center' || alignment === 'right' ? alignment : 'left',
    fontFamily: readString(o, 'fontFamily', 'sans'),
  }
}

function decodeShape(inner: unknown): ShapeContent {
  const o = asRecord(inner, 'shape')
  const shapeType = o.shapeType
  const strokeStyle = o.strokeStyle
  const fillStyle = o.fillStyle
  return {
    shapeType: shapeType === 'ellipse' || shapeType === 'diamond' ? shapeType : 'rect',
    fillColor: readString(o, 'fillColor', 'blue'),
    strokeColor: readString(o, 'strokeColor', 'blue'),
    strokeWidth: readNumber(o, 'strokeWidth', 2.0),
    strokeStyle: strokeStyle === 'dashed' || strokeStyle === 'dotted' ? strokeStyle : 'solid',
    fillStyle:
      fillStyle === 'none' || fillStyle === 'hatched' || fillStyle === 'crossHatched' ? fillStyle : 'solid',
    text: readString(o, 'text', ''),
    fontSize: readNumber(o, 'fontSize', 16),
    rotation: readNumber(o, 'rotation', 0),
  }
}

function decodeStroke(inner: unknown): StrokeContent {
  const o = asRecord(inner, 'stroke')
  const strokeStyle = o.strokeStyle
  const stroke: StrokeContent = {
    strokeType: o.strokeType === 'arrow' ? 'arrow' : 'line',
    startPoint: pointFromArray(o.startPoint) ?? { x: 0, y: 0.5 },
    endPoint: pointFromArray(o.endPoint) ?? { x: 1, y: 0.5 },
    strokeColor: readString(o, 'strokeColor', 'blue'),
    strokeWidth: readNumber(o, 'strokeWidth', 2.0),
    strokeStyle: strokeStyle === 'dashed' || strokeStyle === 'dotted' ? strokeStyle : 'solid',
  }
  const controlPoint = pointFromArray(o.controlPoint)
  if (controlPoint !== undefined) stroke.controlPoint = controlPoint
  return stroke
}

function decodeFreehand(inner: unknown): FreehandContent {
  const o = asRecord(inner, 'freehand')
  return {
    freehandType: o.freehandType === 'highlighter' ? 'highlighter' : 'pen',
    points: pointsFromArray(readArray(o, 'points')),
    strokeColor: readString(o, 'strokeColor', 'blue'),
    strokeWidth: readNumber(o, 'strokeWidth', 3.0),
    opacity: readNumber(o, 'opacity', 1.0),
    rotation: readNumber(o, 'rotation', 0),
  }
}

// ---------------------------------------------------------------------------
// Fabrica de conteudos com defaults identicos ao Swift
// ---------------------------------------------------------------------------

export function createTerminalContent(
  name: string,
  workingDirectory: string,
  overrides: Partial<TerminalContent> = {},
): TerminalContent {
  return {
    agentType: 'generic_shell',
    command: '',
    name,
    icon: 'terminal',
    color: '#007AFF',
    // Um id vazio e rejeitado por `requireUuid` na releitura: o nó desapareceria
    // do workspace depois de um restart. Sempre gera um.
    id: overrides.id ?? newId(),
    shellPath: '',
    workingDirectory,
    status: 'idle',
    isManager: false,
    monitorWithOmbro: false,
    autoScrollLocked: false,
    shortcutMode: { kind: 'automatic' },
    scrollbackLineCount: 0,
    ...overrides,
  }
}

export function createStickyNoteContent(name: string, overrides: Partial<StickyNoteContent> = {}): StickyNoteContent {
  return {
    color: '#FEFDE8',
    fileName: `${name}.md`,
    fontSize: 14,
    hasCustomName: false,
    isPreviewing: false,
    storageMode: { managed: {} },
    ...overrides,
  }
}

export function createPortalContent(name: string, url = '', id = newId()): PortalContent {
  return {
    id,
    name,
    currentURL: url,
    source: url ? { url } : { none: true },
    status: 'idle',
    chromeHidden: false,
    storageScope: 'isolated',
  }
}

export function createFileTreeContent(name: string, rootPath: string): FileTreeContent {
  return { name, rootPath, viewMode: 'list' }
}

export function createTextContent(text = ''): TextContent {
  return { text, fontSize: 18, fontWeight: 'regular', color: '#1a1a1a', alignment: 'left', fontFamily: 'sans' }
}


