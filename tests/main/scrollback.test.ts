import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn } from '@lydell/node-pty'
import type { IPty } from '@lydell/node-pty'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_SCROLLBACK_LINES } from '@shared/constants'
import { load, save } from '../../src/main/terminal/scrollback-store'
import { TerminalSession } from '../../src/main/terminal/terminal-session'

vi.mock('@lydell/node-pty', () => ({ spawn: vi.fn() }))

describe('scrollback', () => {
  let path: string

  beforeEach(async () => {
    path = join(await mkdtemp(join(tmpdir(), 'omaestri-scrollback-')), 'terminal.scrollback')
  })

  afterEach(async () => {
    await rm(path, { force: true })
    await rmdir(dirname(path))
  })

  it('grava e le texto puro separado por LF', async () => {
    const lines = ['linha 1', 'linha 2']
    await save(path, lines)

    expect(await readFile(path, 'utf8')).toBe('linha 1\nlinha 2')
    expect(await load(path)).toEqual(lines)
  })

  it('devolve uma lista vazia quando o arquivo nao existe', async () => {
    expect(await load(path)).toEqual([])
  })

  it('preserva somente as ultimas 5000 linhas e respeita a ordem dos flushes', async () => {
    const lines = Array.from({ length: MAX_SCROLLBACK_LINES + 1 }, (_, index) => `linha ${index}`)
    await Promise.all([save(path, ['anterior']), save(path, lines)])

    expect(await load(path)).toEqual(lines.slice(1))
  })

  it('restaura antes da primeira saida e grava dados pendentes no kill', async () => {
    await save(path, ['restaurada'])
    const ptyEvents = new EventEmitter()
    const fakePty: Pick<IPty, 'onData' | 'onExit' | 'kill'> = {
      onData: (callback) => {
        ptyEvents.on('data', callback)
        return { dispose: () => { ptyEvents.off('data', callback) } }
      },
      onExit: () => ({ dispose: () => undefined }),
      kill: vi.fn(),
    }
    vi.mocked(spawn).mockReturnValueOnce(fakePty as IPty)

    const session = await TerminalSession.create({
      id: '5F0AC4E9-75BC-45B9-8572-EFC762672400',
      name: 'Scrollback',
      agentType: 'generic_shell',
      shellPath: 'cmd.exe',
      workingDirectory: dirname(path),
      cols: 80,
      rows: 24,
      env: {},
      scrollbackPath: path,
    })

    try {
      expect(session.snapshot()).toBe('restaurada')
      const firstOutput = new Promise<string>((resolve) => session.onData(() => resolve(session.snapshot())))
      ptyEvents.emit('data', 'nova\r\n')
      await expect(firstOutput).resolves.toBe('restaurada\nnova')

      ptyEvents.emit('data', 'ultima\r\n')
      session.kill()
      await vi.waitFor(async () => expect(await load(path)).toEqual(['restaurada', 'nova', 'ultima']))
    } finally {
      session.kill()
    }
  })
})
