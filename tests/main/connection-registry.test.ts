import { describe, expect, it } from 'vitest'

import { createStickyNoteContent, createTerminalContent } from '@shared/models/node-content'
import { createCanvasNode, createWorkspacePayload } from '@shared/models/workspace'
import { ConnectionRegistry, terminalNames } from '../../src/main/connection/connection-registry'
import { buildConnectionBanner, formatAskHint } from '../../src/main/connection/role-injection'

const frame = { x: 0, y: 0, width: 100, height: 100 }

function makeWorkspace() {
  const payload = createWorkspacePayload('WORKSPACE', 'Teste', '.')
  for (const [id, name] of [['A', 'NomeA'], ['B', 'Nome1'], ['C', 'Nome2'], ['D', 'Isolado']] as const) {
    const content = createTerminalContent(name, '.', { id })
    payload.nodes.push(createCanvasNode(`NODE-${id}`, frame, { type: 'terminal', value: content }))
  }
  for (const [id, name] of [['NOTE-SPEC', 'Spec'], ['NOTE-PLAN', 'Plano']] as const) {
    const content = createStickyNoteContent(name)
    payload.nodes.push(createCanvasNode(id, frame, { type: 'stickyNote', value: content }))
  }
  return payload
}

const connection = { id: 'LINK', createdAt: new Date(0), ropePoints: [] }

describe('ConnectionRegistry', () => {
  it('indexa A-B e B-A pelos IDs de TerminalContent, nao pelos IDs dos nos', () => {
    const payload = makeWorkspace()
    for (const [terminalIdA, terminalIdB] of [['A', 'B'], ['B', 'A']] as const) {
      payload.connections = [{ ...connection, terminalIdA, terminalIdB }]
      const registry = new ConnectionRegistry(payload)

      expect(registry.peersOf('A')).toEqual(['B'])
      expect(registry.peersOf('B')).toEqual(['A'])
      expect(registry.peersOf('NODE-A')).toEqual([])
      expect(registry.isConnected('A', 'B')).toBe(true)
      expect(registry.isConnected('B', 'A')).toBe(true)
    }
    expect(terminalNames(payload).get('A')).toBe('NomeA')
    expect(terminalNames(payload).has('NODE-A')).toBe(false)
  })

  it('ordena peers, remove duplicatas e descarta conexoes orfas', () => {
    const payload = makeWorkspace()
    payload.connections = [
      { ...connection, terminalIdA: 'C', terminalIdB: 'A' },
      { ...connection, terminalIdA: 'A', terminalIdB: 'B' },
      { ...connection, terminalIdA: 'B', terminalIdB: 'A' },
      { ...connection, terminalIdA: 'A', terminalIdB: 'NODE-C' },
    ]
    const registry = new ConnectionRegistry(payload)

    expect(registry.peersOf('A')).toEqual(['B', 'C'])
    expect(registry.isConnected('B', 'C')).toBe(false)

    payload.connections = []
    registry.rebuild(payload)
    expect(registry.peersOf('A')).toEqual([])
    expect(registry.isConnected('B', 'A')).toBe(false)
  })

  it('mantem nota vinculada fora dos peers e inclui apenas a linha de notas', () => {
    const payload = makeWorkspace()
    payload.noteConnections = [{ ...connection, terminalId: 'A', noteNodeId: 'NOTE-SPEC' }]
    const registry = new ConnectionRegistry(payload)

    expect(registry.linkedNotesOf('A')).toEqual(['NOTE-SPEC'])
    expect(registry.peersOf('A')).toEqual([])
    expect(registry.isConnected('A', 'NOTE-SPEC')).toBe(false)
    expect(buildConnectionBanner(registry, 'A', terminalNames(payload))).toBe('-- notas vinculadas: Spec.md')
  })

  it('gera o banner com nomes e devolve string vazia para terminal isolado', () => {
    const payload = makeWorkspace()
    payload.connections = [
      { ...connection, terminalIdA: 'A', terminalIdB: 'B' },
      { ...connection, terminalIdA: 'A', terminalIdB: 'C' },
    ]
    payload.noteConnections = [
      { ...connection, terminalId: 'A', noteNodeId: 'NOTE-SPEC' },
      { ...connection, terminalId: 'A', noteNodeId: 'NOTE-PLAN' },
    ]
    const registry = new ConnectionRegistry(payload)
    const names = terminalNames(payload)

    expect(buildConnectionBanner(registry, 'D', names)).toBe('')
    expect(buildConnectionBanner(registry, 'A', names)).toBe(
      '-- conectado a: Nome1, Nome2\n-- notas vinculadas: Spec.md, Plano.md',
    )
    expect(formatAskHint()).toBe('para falar com um agente conectado use: omaestri ask "Nome" "prompt"')
  })
})
