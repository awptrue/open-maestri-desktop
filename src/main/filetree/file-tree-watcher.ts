import { isAbsolute, relative, resolve, sep } from 'node:path'
import { FSWatcher } from 'chokidar'

import { createLogger, describeError } from '../logger'

const log = createLogger('FileTreeWatcher')
const DEBOUNCE_MS = 150
const HIDDEN_PATH = /(^|[/\\])\./

type ChangeListener = (changedPath: string) => void

interface WatchEntry {
  watcher: FSWatcher
  targets: Set<string>
  ready: Promise<void>
  resolveReady: () => void
  onChange: ChangeListener
  timer?: NodeJS.Timeout
}

function pathKey(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

function isOutside(path: string): boolean {
  return isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)
}

export class DirectoryWatcher {
  private readonly watchers = new Map<string, WatchEntry>()

  watch(rootPath: string, relativePath: string, onChange: ChangeListener): Promise<void> {
    let key: string | undefined
    try {
      const root = resolve(rootPath)
      const target = resolve(root, relativePath)
      key = pathKey(root)
      const targetKey = pathKey(target)
      const targetRelative = relative(root, target)
      if (isOutside(targetRelative)) {
        log.warn(`Nao foi possivel observar caminho fora da raiz: ${target}`)
        return Promise.resolve()
      }
      if (HIDDEN_PATH.test(targetRelative)) return Promise.resolve()

      const existing = this.watchers.get(key)
      if (existing) {
        existing.onChange = onChange
        if (!existing.targets.has(targetKey)) {
          existing.targets.add(targetKey)
          existing.watcher.add(target)
        }
        return existing.ready
      }

      const watcher = new FSWatcher({
        ignoreInitial: true,
        depth: 1,
        followSymlinks: false,
        ignored: (path) => {
          const inside = relative(root, path)
          return !isOutside(inside) && HIDDEN_PATH.test(inside)
        },
      })
      let resolveReady!: () => void
      const ready = new Promise<void>((resolve) => { resolveReady = resolve })
      const entry: WatchEntry = { watcher, targets: new Set([targetKey]), ready, resolveReady, onChange }
      const rootKey = key
      this.watchers.set(rootKey, entry)
      watcher.once('ready', resolveReady)
      watcher.on('error', (error) => {
        log.warn(`Falha ao observar ${root}: ${describeError(error)}`)
        if (this.watchers.get(rootKey) === entry) void this.close(rootKey)
      })
      watcher.on('all', (_event, changedPath) => {
        if (this.watchers.get(rootKey) !== entry) return
        clearTimeout(entry.timer)
        entry.timer = setTimeout(() => {
          entry.timer = undefined
          if (this.watchers.get(rootKey) !== entry) return
          try {
            entry.onChange(resolve(changedPath))
          } catch (error) {
            log.warn(`Falha ao notificar mudanca em ${root}: ${describeError(error)}`)
          }
        }, DEBOUNCE_MS).unref()
      })
      watcher.add(target)
      return ready
    } catch (error) {
      log.warn(`Falha ao iniciar observacao de ${rootPath}: ${describeError(error)}`)
      return key === undefined ? Promise.resolve() : this.close(key)
    }
  }

  async unwatch(rootPath: string): Promise<void> {
    try {
      await this.close(pathKey(resolve(rootPath)))
    } catch (error) {
      log.warn(`Falha ao encerrar observacao de ${rootPath}: ${describeError(error)}`)
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all(Array.from(this.watchers.keys(), (key) => this.close(key)))
  }

  private async close(key: string): Promise<void> {
    const entry = this.watchers.get(key)
    if (!entry) return
    this.watchers.delete(key)
    clearTimeout(entry.timer)
    entry.resolveReady()
    try {
      await entry.watcher.close()
    } catch (error) {
      log.warn(`Falha ao fechar watcher de ${key}: ${describeError(error)}`)
    }
  }
}
