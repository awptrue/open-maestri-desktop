/**
 * Teste de integracao do processo main: persistencia + PTY real + roteador CLI.
 *
 * O typecheck prova tipos; este teste prova o caminho de runtime no Windows:
 * ConPTY sobe de verdade, o headless do main recebe a saida, o workspace.json
 * resultante e legivel no formato do macOS. Nada aqui abre janela.
 */

import { promises as fs } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { PersistenceManager } from '../../src/main/persistence/persistence-manager'
import { WorkspaceStore } from '../../src/main/workspace/workspace-store'
import { TerminalManager } from '../../src/main/terminal/terminal-manager'
import { createPaths } from '../../src/main/paths'
import { createRouter } from '../../src/main/ipc-server/router'
import { decodeWorkspaceDocument } from '@shared/models/workspace'

const cleanup: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn()
})

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'omaestri-test-'))
  cleanup.push(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

describe('runtime — persistencia e PTY no Windows', () => {
  it('cria workspace, grava workspace.json legivel e recarrega', async () => {
    const root = makeRoot()
    const paths = createPaths(root)
    const persistence = new PersistenceManager(paths)
    const terminals = new TerminalManager()
    const store = new WorkspaceStore(persistence, terminals, 60_000)
    cleanup.push(() => store.shutdown().catch(() => undefined))

    await store.load()
    const doc = await store.createWorkspace('Smoke', root)
    await store.flush()

    const raw = JSON.parse(await fs.readFile(paths.workspaceJson(doc.payload.id), 'utf8')) as unknown
    const decoded = decodeWorkspaceDocument(raw)

    expect(decoded.payload.name).toBe('Smoke')
    expect(Array.isArray((raw as Record<string, unknown>).payload)).toBe(false)
    // CGPoint no Darwin e array, nao objeto.
    const payload = (raw as { payload: Record<string, unknown> }).payload
    expect(Array.isArray(payload.canvasOrigin)).toBe(true)

    const reopened = await store.openWorkspace(doc.payload.id)
    expect(reopened?.payload.name).toBe('Smoke')
  })

  it('sobe um PTY real e enxerga a saida pelo buffer do main', async () => {
    const terminals = new TerminalManager()
    cleanup.push(() => terminals.destroyAll())

    const session = await terminals.create({
      id: 'AAAA-BBBB',
      name: 'Smoke',
      agentType: 'generic_shell',
      workingDirectory: process.cwd(),
      cols: 100,
      rows: 30,
    })

    expect(session.isRunning).toBe(true)

    // Marcador unico: se aparecer no buffer, o caminho PTY -> headless funciona.
    const marker = `OMAESTRI_SMOKE_${Date.now()}`
    session.write(`echo ${marker}\r`)

    const found = await waitFor(() => session.snapshot().includes(marker), 10_000)
    expect(found).toBe(true)

    terminals.destroy('AAAA-BBBB')
    expect(terminals.get('AAAA-BBBB')).toBeUndefined()
  })

  it('roteador responde list com o terminal criado e recusa nome inexistente', async () => {
    const root = makeRoot()
    const paths = createPaths(root)
    const persistence = new PersistenceManager(paths)
    const terminals = new TerminalManager()
    const store = new WorkspaceStore(persistence, terminals, 60_000)
    cleanup.push(() => {
      terminals.destroyAll()
      return store.shutdown().catch(() => undefined)
    })

    await store.load()
    await store.createWorkspace('Router', root)

    const router = createRouter({ store, terminals, persistence })

    const empty = await router(['list'])
    expect(empty).toMatch(/Nenhum terminal conectado/)

    await terminals.create({
      id: 'CCCC-DDDD',
      name: 'Codex',
      agentType: 'generic_shell',
      workingDirectory: root,
      cols: 80,
      rows: 24,
    })

    const listed = await router(['list'])
    expect(listed).toContain('Codex')
    expect(listed).toContain('CCCC-DDDD')

    const missing = await router(['ask', 'Inexistente', 'oi'])
    expect(missing).toMatch(/^error: /)
    expect(missing).toContain('nao encontrado')
  })

  it('so marca needsRecovery quando o run anterior morreu sem shutdown', async () => {
    const root = makeRoot()
    const paths = createPaths(root)

    // Primeiro boot de um diretorio novo: nao ha nada a recuperar.
    const first = new WorkspaceStore(new PersistenceManager(paths), new TerminalManager(), 60_000)
    await first.load()
    expect(first.needsRecovery).toBe(false)
    await first.shutdown()

    // Boot apos encerramento limpo continua sem recuperacao.
    const clean = new WorkspaceStore(new PersistenceManager(paths), new TerminalManager(), 60_000)
    cleanup.push(() => clean.shutdown().catch(() => undefined))
    await clean.load()
    expect(clean.needsRecovery).toBe(false)
    await clean.shutdown()

    // Processo morto sem `shutdown()`: o disco fica com cleanShutdown=false.
    const crashed = new WorkspaceStore(new PersistenceManager(paths), new TerminalManager(), 60_000)
    await crashed.load()

    const after = new WorkspaceStore(new PersistenceManager(paths), new TerminalManager(), 60_000)
    cleanup.push(() => after.shutdown().catch(() => undefined))
    await after.load()
    expect(after.needsRecovery).toBe(true)
  })
})

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return predicate()
}
