import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DirectoryWatcher } from '../../src/main/filetree/file-tree-watcher'

describe('DirectoryWatcher', () => {
  let root: string
  let watcher: DirectoryWatcher
  let files: string[]

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'omaestri-file-tree-'))
    watcher = new DirectoryWatcher()
    files = []
  })

  afterEach(async () => {
    await watcher.closeAll()
    await Promise.all(files.map((file) => rm(file, { force: true })))
    await rmdir(root)
  })

  async function createFile(name: string): Promise<string> {
    const path = join(root, name)
    files.push(path)
    await writeFile(path, name)
    return path
  }

  it('notifica arquivo criado e reusa o watcher da mesma raiz', async () => {
    const onChange = vi.fn()
    const ready = watcher.watch(root, '', onChange)
    expect(watcher.watch(root, '', onChange)).toBe(ready)
    await ready

    const file = await createFile('novo.txt')
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(file), { timeout: 5000 })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('para de notificar depois de unwatch', async () => {
    const onChange = vi.fn()
    await watcher.watch(root, '', onChange)
    const before = await createFile('antes.txt')
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(before), { timeout: 5000 })

    await watcher.unwatch(root)
    onChange.mockClear()
    await createFile('depois.txt')
    await delay(500)
    expect(onChange).not.toHaveBeenCalled()
  })
})
