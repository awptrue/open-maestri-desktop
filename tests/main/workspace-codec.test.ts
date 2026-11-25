import { describe, expect, it } from 'vitest'
import {
  decodeWorkspaceDocument,
  encodeWorkspaceDocument,
  nodeIdsByType,
  type WorkspacePayload,
} from '@shared/models/workspace'
import { encodeDate, newId, isUuid } from '@shared/models/codec'
import { frameFromArray, frameToArray } from '@shared/models/geometry'
import { MACOS_FULL_WORKSPACE, MACOS_MINIMAL_WORKSPACE, MACOS_TERMINAL_NODE } from '../fixtures/macos-workspaces'

/** Percorre recursivamente todo o JSON e verifica que nunca existe `null`. */
function assertNoNull(value: unknown, path = '$'): void {
  if (value === null) throw new Error(`null encontrado em ${path}`)
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoNull(v, `${path}[${i}]`))
    return
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) throw new Error(`undefined encontrado em ${path}.${k}`)
      assertNoNull(v, `${path}.${k}`)
    }
  }
}

describe('workspace.json — leitura do formato macOS', () => {
  it('lê o fixture mínimo oficial', () => {
    const doc = decodeWorkspaceDocument(MACOS_MINIMAL_WORKSPACE)
    expect(doc.schemaVersion).toBe(2)
    expect(doc.type).toBe('workspace')
    expect(doc.payload.id).toBe('00000000-0000-0000-0000-000000000001')
    // O fixture oficial usa objeto `{x,y}`, mas o Swift grava CGPoint como
    // `[x,y]`. O decoder aceita os dois formatos.
    expect(doc.payload.canvasOrigin).toEqual({ x: 9800, y: 8500 })
    expect(doc.payload.canvasZoom).toBe(1)
    expect(doc.payload.nodes).toHaveLength(0)
  })

  it('lê o fixture completo com todos os tipos de nó', () => {
    const doc = decodeWorkspaceDocument(MACOS_FULL_WORKSPACE)
    expect(doc.payload.nodes).toHaveLength(5)
    // Valores NAO-default: se a leitura de canvasOrigin/canvasZoom quebrar, o
    // decoder cairia em (9800,8500)/1.0 e este teste falharia.
    expect(doc.payload.canvasOrigin).toEqual({ x: 123, y: 456 })
    expect(doc.payload.canvasZoom).toBe(0.75)

    const terminal = doc.payload.nodes.find((n) => n.content.type === 'terminal')
    expect(terminal).toBeDefined()
    if (terminal?.content.type === 'terminal') {
      expect(terminal.content.value.agentType).toBe('claude_code')
      expect(terminal.content.value.name).toBe('Agent')
      expect(terminal.content.value.id).toBe('00000000-0000-0000-0000-000000000002')
      expect(terminal.content.value.shortcutMode.kind).toBe('automatic')
    }

    const note = doc.payload.nodes.find((n) => n.content.type === 'stickyNote')
    if (note?.content.type === 'stickyNote') {
      expect(note.content.value.fileName).toBe('Spec.md')
      expect(note.content.value.storageMode).toEqual({ managed: {} })
    }

    const portal = doc.payload.nodes.find((n) => n.content.type === 'portal')
    if (portal?.content.type === 'portal') {
      expect(portal.content.value.source).toEqual({ url: 'https://example.com' })
      expect(portal.content.value.storageScope).toBe('isolated')
    }

    expect(doc.payload.connections).toHaveLength(1)
    expect(doc.payload.noteConnections).toHaveLength(1)
    expect(doc.payload.portalConnections).toHaveLength(1)
    expect(doc.payload.lastOpenedAt).toBeInstanceOf(Date)
  })

  it('preserva frame [[x,y],[w,h]] do nó terminal', () => {
    const doc = decodeWorkspaceDocument({ schemaVersion: 2, type: 'workspace', payload: { ...MACOS_MINIMAL_WORKSPACE.payload, nodes: [MACOS_TERMINAL_NODE] } })
    const node = doc.payload.nodes[0]
    expect(node?.frame).toEqual({ x: 100, y: 200, width: 400, height: 300 })
  })

  it('descarta nó corrompido sem derrubar o workspace inteiro', () => {
    const broken = { ...MACOS_TERMINAL_NODE, frame: [[100]] }
    const doc = decodeWorkspaceDocument({
      schemaVersion: 2,
      type: 'workspace',
      payload: { ...MACOS_MINIMAL_WORKSPACE.payload, nodes: [broken, MACOS_TERMINAL_NODE] },
    })
    expect(doc.payload.nodes).toHaveLength(1)
  })

  it('descarta nó de tipo desconhecido (workspace do futuro)', () => {
    const future = { ...MACOS_TERMINAL_NODE, content: { hologram: { _0: { a: 1 } } } }
    const doc = decodeWorkspaceDocument({
      schemaVersion: 2,
      type: 'workspace',
      payload: { ...MACOS_MINIMAL_WORKSPACE.payload, nodes: [future] },
    })
    expect(doc.payload.nodes).toHaveLength(0)
  })

  it('lê payload na raiz (formato legado v1 sem envelope)', () => {
    const doc = decodeWorkspaceDocument({ schemaVersion: 1, type: 'workspace', ...MACOS_MINIMAL_WORKSPACE.payload })
    expect(doc.payload.name).toBe('Test Workspace')
    expect(doc.payload.nodes).toEqual([])
  })
})

describe('workspace.json — escrita compativel', () => {
  it('grava o envelope {schemaVersion, type, payload}', () => {
    const doc = decodeWorkspaceDocument(MACOS_MINIMAL_WORKSPACE)
    const out = encodeWorkspaceDocument(doc)
    expect(Object.keys(out).sort()).toEqual(['payload', 'schemaVersion', 'type'])
    expect(out.schemaVersion).toBe(2)
    expect(out.type).toBe('workspace')
    expect(typeof out.payload).toBe('object')
  })

  it('grava content com envelope _0 e frame como array de arrays', () => {
    const doc = decodeWorkspaceDocument({ schemaVersion: 2, type: 'workspace', payload: { ...MACOS_MINIMAL_WORKSPACE.payload, nodes: [MACOS_TERMINAL_NODE] } })
    const out = encodeWorkspaceDocument(doc)
    const nodes = (out.payload as Record<string, unknown>).nodes as Record<string, unknown>[]
    const node = nodes[0]!

    expect(node.frame).toEqual([
      [100, 200],
      [400, 300],
    ])
    const content = node.content as Record<string, unknown>
    expect(Object.keys(content)).toEqual(['terminal'])
    expect(Object.keys(content.terminal as Record<string, unknown>)).toEqual(['_0'])
  })

  it('grava canvasOrigin como array CGPoint, nao como objeto', () => {
    const doc = decodeWorkspaceDocument(MACOS_FULL_WORKSPACE)
    const out = encodeWorkspaceDocument(doc)
    const payload = out.payload as Record<string, unknown>
    // Formato do encoder real do Darwin: CGPoint vira [x, y].
    expect(payload.canvasOrigin).toEqual([123, 456])
    expect(Array.isArray(payload.canvasOrigin)).toBe(true)
  })

  it('lê canvasOrigin nos dois formatos (array e objeto)', () => {
    const asArray = decodeWorkspaceDocument({
      schemaVersion: 2,
      type: 'workspace',
      payload: { ...MACOS_MINIMAL_WORKSPACE.payload, canvasOrigin: [10, 20] },
    })
    expect(asArray.payload.canvasOrigin).toEqual({ x: 10, y: 20 })

    const asObject = decodeWorkspaceDocument({
      schemaVersion: 2,
      type: 'workspace',
      payload: { ...MACOS_MINIMAL_WORKSPACE.payload, canvasOrigin: { x: 30, y: 40 } },
    })
    expect(asObject.payload.canvasOrigin).toEqual({ x: 30, y: 40 })
  })

  it('nunca grava null em nenhum campo (opcionais sao omitidos)', () => {
    const doc = decodeWorkspaceDocument(MACOS_FULL_WORKSPACE)
    const out = encodeWorkspaceDocument(doc)
    expect(() => assertNoNull(out)).not.toThrow()
  })

  it('grava datas ISO8601 sem fracao de segundo', () => {
    const doc = decodeWorkspaceDocument(MACOS_FULL_WORKSPACE)
    const out = encodeWorkspaceDocument(doc)
    const payload = out.payload as Record<string, unknown>
    const createdAt = payload.createdAt as string

    expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(createdAt).not.toContain('.')
  })

  it('grava UUID em maiusculo', () => {
    const doc = decodeWorkspaceDocument({
      schemaVersion: 2,
      type: 'workspace',
      payload: { ...MACOS_MINIMAL_WORKSPACE.payload, id: '11111111-1111-4111-8111-111111111111' },
    })
    const out = encodeWorkspaceDocument(doc)
    const payload = out.payload as Record<string, unknown>
    expect(payload.id).toBe('11111111-1111-4111-8111-111111111111')
  })
})

describe('workspace.json — round trip', () => {
  it('decode(encode(decode(x))) e estavel no fixture completo', () => {
    const first = decodeWorkspaceDocument(MACOS_FULL_WORKSPACE)
    const encoded = encodeWorkspaceDocument(first)
    const second = decodeWorkspaceDocument(JSON.parse(JSON.stringify(encoded)))
    const third = encodeWorkspaceDocument(second)

    expect(third).toEqual(encoded)
    expect(second.payload.nodes.map((n) => n.id)).toEqual(first.payload.nodes.map((n) => n.id))
    expect(second.payload.connections).toEqual(first.payload.connections)
  })

  it('preserva zIndex, isLocked e lastModifiedAt', () => {
    const doc = decodeWorkspaceDocument(MACOS_FULL_WORKSPACE)
    const locked = doc.payload.nodes.find((n) => n.isLocked)
    expect(locked?.zIndex).toBe(4)
    const round = decodeWorkspaceDocument(encodeWorkspaceDocument(doc))
    const lockedAgain = round.payload.nodes.find((n) => n.isLocked)
    expect(lockedAgain?.zIndex).toBe(4)
    expect(lockedAgain?.lastModifiedAt.toISOString()).toBe(locked?.lastModifiedAt.toISOString())
  })
})

describe('helpers de dominio', () => {
  it('newId gera UUID maiusculo valido', () => {
    const id = newId()
    expect(isUuid(id)).toBe(true)
    expect(id).toBe(id.toUpperCase())
  })

  it('encodeDate remove milissegundos', () => {
    expect(encodeDate(new Date('2026-05-16T00:00:00.123Z'))).toBe('2026-05-16T00:00:00Z')
  })

  it('frame round trip', () => {
    const frame = { x: 1.5, y: -2, width: 300, height: 200 }
    expect(frameFromArray(frameToArray(frame))).toEqual(frame)
  })

  it('frameFromArray rejeita formatos invalidos', () => {
    expect(frameFromArray([[1]])).toBeUndefined()
    expect(frameFromArray([[1], [2]])).toBeUndefined()
    expect(frameFromArray([])).toBeUndefined()
    expect(frameFromArray('x')).toBeUndefined()
  })

  it('nodeIdsByType separa id do conteúdo do id do frame no terminal', () => {
    const payload = decodeWorkspaceDocument(MACOS_FULL_WORKSPACE).payload as WorkspacePayload
    const terminalIds = nodeIdsByType(payload, 'terminal')
    expect(terminalIds.has('00000000-0000-0000-0000-000000000002')).toBe(true)
    expect(terminalIds.has('00000000-0000-0000-0000-000000000001')).toBe(false)

    const noteIds = nodeIdsByType(payload, 'stickyNote')
    expect(noteIds.has('22222222-2222-4222-8222-222222222222')).toBe(true)
  })
})
