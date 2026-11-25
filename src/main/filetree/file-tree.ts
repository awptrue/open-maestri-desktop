/**
 * Leitura de diretorio para o no de file tree.
 *
 * A regra de I/O do projeto vale para `~/.open-maestri/`; aqui o acesso e a
 * arvore do usuario, sempre dentro de `rootPath` — `resolve` + verificacao de
 * prefixo impede que um `relativePath` com `..` escape da raiz escolhida.
 */

import { promises as fs } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

import type { FileTreeEntry, FileTreeListResult } from '@shared/ipc-contract'

import { createLogger } from '../logger'
import { describeError } from '../logger'
import { DirectoryWatcher } from './file-tree-watcher'

const log = createLogger('FileTree')

/** Limite por diretorio: uma pasta com 50k entradas travava o renderer antigo. */
const MAX_ENTRIES = 2000
const directoryWatcher = new DirectoryWatcher()

export function watchDirectory(
  rootPath: string,
  relativePath: string,
  onChange: (changedPath: string) => void,
): Promise<void> {
  return directoryWatcher.watch(rootPath, relativePath, onChange)
}

export function unwatchDirectory(rootPath: string): Promise<void> {
  return directoryWatcher.unwatch(rootPath)
}

export function closeAllDirectoryWatchers(): Promise<void> {
  return directoryWatcher.closeAll()
}

export async function listDirectory(rootPath: string, relativePath = ''): Promise<FileTreeListResult> {
  const root = resolve(rootPath)
  const target = resolve(root, relativePath)

  // Escape de raiz: `../../Windows` nao pode ser listado.
  if (target !== root && !target.startsWith(root + sep)) {
    return { relativePath, entries: [], error: 'caminho fora da raiz do no' }
  }

  try {
    const dirents = await fs.readdir(target, { withFileTypes: true })
    const entries: FileTreeEntry[] = dirents
      .filter((d) => !d.name.startsWith('.') || d.name === '.env.example')
      .map((d) => ({
        name: d.name,
        path: relative(root, resolve(target, d.name)),
        isDirectory: d.isDirectory(),
      }))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
      })
      .slice(0, MAX_ENTRIES)

    return { relativePath, entries }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    const message =
      code === 'ENOENT'
        ? 'diretorio nao encontrado'
        : code === 'EACCES' || code === 'EPERM'
          ? 'sem permissao de leitura'
          : describeError(e)
    log.warn(`falha ao listar ${target}: ${message}`)
    return { relativePath, entries: [], error: message }
  }
}
