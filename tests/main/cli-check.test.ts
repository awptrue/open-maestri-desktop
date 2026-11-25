/**
 * Cobertura do comando `check` do roteador do CLI `omaestri`.
 *
 * `check` toca apenas `terminals.findByName(...)` e `bufferLines()`, entao os
 * dublês abaixo substituem PTY real e store, mantendo o teste rapido e
 * deterministico. Nenhum import de `electron` e necessario.
 */

import { describe, expect, it } from 'vitest'

import type { PersistenceManager } from '../../src/main/persistence/persistence-manager'
import type { TerminalManager } from '../../src/main/terminal/terminal-manager'
import type { WorkspaceStore } from '../../src/main/workspace/workspace-store'
import { createRouter, type Router } from '../../src/main/ipc-server/router'

const AGENT = 'Builder'

function makeRouter(buffer: string[]): Router {
  const terminal = { name: AGENT, bufferLines: () => buffer }
  const terminals = {
    findByName: (name: string) => (name === AGENT ? terminal : undefined),
  } as unknown as TerminalManager
  const store = {
    getActivePayload: () => ({ id: 'WORKSPACE-TESTE', nodes: [] }),
  } as unknown as WorkspaceStore
  const persistence = {} as unknown as PersistenceManager

  return createRouter({ store, terminals, persistence })
}

function numbered(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `linha ${index + 1}`)
}

describe('check', () => {
  it('exige o nome do agente', async () => {
    const router = makeRouter([])
    expect(await router(['check'])).toBe('error: uso: omaestri check "Nome" [linhas]')
  })

  it('reporta agente inexistente', async () => {
    const router = makeRouter([])
    expect(await router(['check', 'Fantasma'])).toBe(
      "error: agente 'Fantasma' nao encontrado. Rode 'omaestri list'.",
    )
  })

  it('devolve (sem saida) quando o buffer esta vazio', async () => {
    const router = makeRouter([])
    expect(await router(['check', AGENT])).toBe('(sem saida)')
  })

  it('usa 60 linhas por padrao e sempre inclui a ultima', async () => {
    const buffer = numbered(100)
    const output = await makeRouter(buffer)(['check', AGENT])
    const lines = output.split('\n')

    expect(lines).toHaveLength(60)
    expect(lines[0]).toBe('linha 41')
    expect(lines[lines.length - 1]).toBe('linha 100')
    expect(output).toBe(buffer.slice(-60).join('\n'))
  })

  it('respeita o limite explicito de linhas', async () => {
    const buffer = numbered(100)
    const output = await makeRouter(buffer)(['check', AGENT, '5'])
    const lines = output.split('\n')

    expect(lines).toHaveLength(5)
    expect(lines[0]).toBe('linha 96')
    expect(lines[lines.length - 1]).toBe('linha 100')
    expect(output).toBe(buffer.slice(-5).join('\n'))
  })

  it('cai no padrao 60 quando o numero e invalido', async () => {
    const buffer = numbered(100)
    const router = makeRouter(buffer)

    for (const invalid of ['0', '-3', 'dez']) {
      const output = await router(['check', AGENT, invalid])
      const lines = output.split('\n')

      expect(lines).toHaveLength(60)
      expect(lines[0]).toBe('linha 41')
      expect(lines[lines.length - 1]).toBe('linha 100')
    }
  })

  it('devolve tudo quando o buffer e menor que o limite', async () => {
    const output = await makeRouter(['a', 'b', 'c'])(['check', AGENT, '10'])
    expect(output).toBe('a\nb\nc')
  })
})

/**
 * Escopo por conexao: `check` so alcanca terminais ligados ao chamador, igual
 * a `ask`. Um agente nao pode ler a saida de qualquer no do canvas.
 */
describe('check restrito aos conectados', () => {
  const CALLER = 'AAAA-1111'
  const PEER = 'BBBB-2222'

  function scopedRouter(connected: boolean) {
    const peer = { id: PEER, name: AGENT, bufferLines: () => ['saida do peer'] }
    const caller = { id: CALLER, name: 'Chamador', bufferLines: () => [] }
    const terminals = {
      get: (id: string) => (id === CALLER ? caller : undefined),
      findByName: (name: string, restrictTo?: Set<string>) => {
        if (name !== AGENT) return undefined
        if (restrictTo && !restrictTo.has(PEER)) return undefined
        return peer
      },
    } as unknown as TerminalManager
    const store = {
      getActivePayload: () => ({
        id: 'W',
        nodes: [],
        connections: connected
          ? [{ id: 'C1', terminalIdA: CALLER, terminalIdB: PEER }]
          : [{ id: 'C2', terminalIdA: CALLER, terminalIdB: 'OUTRO' }],
      }),
    } as unknown as WorkspaceStore

    return createRouter({ store, terminals, persistence: {} as unknown as PersistenceManager })
  }

  it('le a saida quando o alvo esta conectado ao chamador', async () => {
    expect(await scopedRouter(true)(['check', AGENT], CALLER)).toBe('saida do peer')
  })

  it('recusa quando o alvo nao esta conectado ao chamador', async () => {
    const result = await scopedRouter(false)(['check', AGENT], CALLER)
    expect(result).toBe(
      "error: nenhum agente conectado chamado 'Builder'. Rode 'omaestri list' para ver os conectados.",
    )
  })
})
