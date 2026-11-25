/**
 * Prova, com PTY real e sem abrir janela, que o processo rodando dentro do
 * terminal enxerga o CLI `omaestri`.
 *
 * Tres camadas:
 * 1. `createEnvironment` (unitario) — PATH com o diretorio dos shims e
 *    `MAESTRI_CLI` apontando para o executavel.
 * 2. PTY real — o shell herda esse ambiente e um processo filho le a variavel.
 * 3. Roteador — `check` devolve a saida de um agente falso rodando no PTY.
 *
 * Nada aqui importa `electron` nem abre janela. Complementa
 * runtime-smoke.test.ts, que cobre persistencia e `list`.
 */

import { mkdtempSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { PersistenceManager } from '../../src/main/persistence/persistence-manager'
import { createPaths } from '../../src/main/paths'
import { createEnvironment, TerminalManager } from '../../src/main/terminal/terminal-manager'
import type { TerminalSession } from '../../src/main/terminal/terminal-session'
import { createRouter } from '../../src/main/ipc-server/router'
import { WorkspaceStore } from '../../src/main/workspace/workspace-store'

const cleanup: Array<() => Promise<void> | void> = []

afterEach(async () => {
  // Ordem inversa: o que foi registrado por ultimo (destroy das sessoes) roda
  // antes da remocao dos temporarios — senao o Windows segura o cwd do shell.
  for (const fn of cleanup.splice(0).reverse()) await fn()
})

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanup.push(() => fs.rm(dir, { recursive: true, force: true }))
  return dir
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return predicate()
}

async function waitForOutput(session: TerminalSession, needle: string): Promise<boolean> {
  return waitFor(() => session.snapshot().includes(needle), 15_000)
}

async function waitForShell(session: TerminalSession): Promise<void> {
  const ready = await waitFor(() => session.snapshot().trim().length > 0, 15_000)
  expect(ready).toBe(true)
}

describe('createEnvironment — shim do CLI no ambiente do terminal', () => {
  it('coloca o cliDir no inicio do PATH e aponta MAESTRI_CLI para o executavel', () => {
    const cliDir = makeTemp('omaestri-cli-')
    const env = createEnvironment('AGENT-0001', 4567, {}, cliDir)

    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path')
    expect(pathKey).toBeDefined()
    const pathValue = pathKey === undefined ? undefined : env[pathKey]
    expect(pathValue).toBeDefined()
    expect(pathValue?.startsWith(`${cliDir}${delimiter}`)).toBe(true)

    const executable = join(cliDir, process.platform === 'win32' ? 'omaestri.cmd' : 'omaestri')
    expect(env.MAESTRI_CLI).toBe(executable)
    if (process.platform === 'win32') {
      expect(env.MAESTRI_CLI?.endsWith('omaestri.cmd')).toBe(true)
    } else {
      expect(env.MAESTRI_CLI?.endsWith('omaestri')).toBe(true)
    }

    // TerminalManager normaliza o id para maiusculas antes de chamar esta
    // funcao; aqui provamos que o valor chega intacto ao ambiente.
    expect(env.MAESTRI_TERMINAL_ID).toBe('AGENT-0001')
  })

  it('nao define MAESTRI_CLI quando nao ha cliDir', () => {
    // O processo de teste pode herdar MAESTRI_CLI de um terminal do Maestri.
    // Removemos da base so durante a chamada para provar que a funcao nao cria.
    const inherited = process.env.MAESTRI_CLI
    delete process.env.MAESTRI_CLI
    try {
      const env = createEnvironment('AGENT-0002')
      expect(env.MAESTRI_CLI).toBeUndefined()
      expect('MAESTRI_CLI' in env).toBe(false)
    } finally {
      if (inherited !== undefined) process.env.MAESTRI_CLI = inherited
    }
  })
})

describe('PTY real — o shell e os filhos herdam o CLI', () => {
  it('processo dentro do terminal enxerga MAESTRI_CLI apontando para o cliDir', async () => {
    const cliDir = makeTemp('omaestri-cli-')
    const root = makeTemp('omaestri-root-')
    const terminals = new TerminalManager()
    cleanup.push(() => terminals.destroyAll())
    terminals.setCliDir(cliDir)

    const session = await terminals.create({
      id: 'cli-ping-1',
      name: 'CliPing',
      agentType: 'generic_shell',
      workingDirectory: root,
      cols: 100,
      rows: 30,
    })

    expect(session.isRunning).toBe(true)
    expect(session.id).toBe('CLI-PING-1')

    await waitForShell(session)

    // Comando agnostico de shell: cmd, powershell e pwsh repassam os aspas.
    session.write(`node -e "console.log('CLI='+(process.env.MAESTRI_CLI||'vazio'))"\r`)
    const found = await waitForOutput(session, `CLI=${cliDir}`)
    expect(found).toBe(true)

    session.write(`node -e "console.log('ID='+(process.env.MAESTRI_TERMINAL_ID||'vazio'))"\r`)
    const idFound = await waitForOutput(session, 'ID=CLI-PING-1')
    expect(idFound).toBe(true)
  }, 40_000)
})

describe('roteador CLI — check le a saida de um agente real no PTY', () => {
  it('check devolve o marcador do agente em execucao e erro para nome inexistente', async () => {
    const agentDir = makeTemp('omaestri-agent-')
    const root = makeTemp('omaestri-root-')

    const marker = `AGENT_READY_${Date.now()}`
    const agentPath = join(agentDir, 'fake-agent.js')
    await fs.writeFile(
      agentPath,
      [
        `console.log(${JSON.stringify(marker)})`,
        'setInterval(() => {}, 1000)',
        // Rede de seguranca: nao deixa processo orfao se o PTY demorar a morrer.
        'setTimeout(() => process.exit(0), 30000)',
      ].join('\n'),
      'utf8',
    )

    const paths = createPaths(root)
    const persistence = new PersistenceManager(paths)
    const terminals = new TerminalManager()
    const store = new WorkspaceStore(persistence, terminals, 60_000)
    cleanup.push(() => store.shutdown().catch(() => undefined))
    cleanup.push(() => terminals.destroyAll())

    await store.load()
    await store.createWorkspace('Agente', root)

    const session = await terminals.create({
      id: 'agent-0001',
      name: 'Agente',
      agentType: 'generic_shell',
      workingDirectory: root,
      cols: 100,
      rows: 30,
    })
    expect(session.id).toBe('AGENT-0001')

    await waitForShell(session)

    session.write(`node "${agentPath}"\r`)
    const started = await waitForOutput(session, marker)
    expect(started).toBe(true)

    const router = createRouter({ store, terminals, persistence })
    const seen = await router(['check', 'Agente'])
    expect(seen).toContain(marker)

    const missing = await router(['check', 'Inexistente'])
    expect(missing).toMatch(/^error: /)
  }, 40_000)
})
