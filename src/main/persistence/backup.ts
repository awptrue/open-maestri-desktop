/**
 * Backups automaticos — porte de `Sources/Workspace/BackupManager.swift`.
 *
 * Formato do arquivo (`.omaestribak`) e o mesmo do macOS, para que um backup
 * criado la possa ser restaurado aqui e vice-versa:
 *
 *   { "files": { "<caminho>": "<base64>" }, "version": 2,
 *     "app": "open-maestri", "createdAt": "<ISO8601>", "fileCount": N }
 *
 * O Swift grava caminhos ABSOLUTOS. Um backup do macOS tem caminhos
 * `/Users/...`, que nao existem no Windows; por isso a restauracao remapeia pelo
 * sufixo (`workspaces/<ID>/workspace.json`, `notes/x.md`, ...) em vez de confiar
 * no caminho literal.
 */

import { promises as fs } from 'node:fs'
import { basename, join, relative } from 'node:path'

import { BACKUP_INTERVAL_SECONDS } from '@shared/constants'

import { createLogger } from '../logger'
import { atomicWriteFile, readJsonFile } from './atomic'
import type { Paths } from '../paths'

const log = createLogger('Backup')

/** Quantos arquivos manter: 24 horas de historico horario (`BackupManager.swift`). */
const KEEP_COUNT = 24

const BACKUP_EXTENSION = '.omaestribak'

interface BackupPayload {
  files: Record<string, string>
  version: number
  app: string
  createdAt: string
  fileCount: number
}

/** `YYYY-MM-DDTHH-MM-SSZ` — o macOS troca `:` por `-` no nome do arquivo. */
function backupFileName(now: Date): string {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-')
  return `open-maestri-${stamp}${BACKUP_EXTENSION}`
}

/** Junta os arquivos que compoem o estado do app, como no Swift. */
async function collectFiles(paths: Paths): Promise<string[]> {
  const files: string[] = []
  const exists = async (path: string): Promise<boolean> => {
    try {
      await fs.access(path)
      return true
    } catch {
      return false
    }
  }

  for (const candidate of [paths.manifest, paths.appState, paths.preferences, paths.routines, paths.sidebarLayout]) {
    if (await exists(candidate)) files.push(candidate)
  }

  const readDir = async (dir: string): Promise<string[]> => {
    try {
      return await fs.readdir(dir)
    } catch {
      return []
    }
  }

  for (const workspaceId of await readDir(paths.workspacesDir)) {
    const workspaceJson = paths.workspaceJson(workspaceId)
    if (await exists(workspaceJson)) files.push(workspaceJson)

    const notesDir = paths.notesDir(workspaceId)
    for (const note of await readDir(notesDir)) {
      if (note.endsWith('.md')) files.push(join(notesDir, note))
    }
  }

  for (const roleId of await readDir(paths.rolesDir)) {
    const roleDir = join(paths.rolesDir, roleId)
    for (const file of await readDir(roleDir)) {
      const path = join(roleDir, file)
      if (!(await fs.stat(path).catch(() => undefined))?.isDirectory()) files.push(path)
    }
  }

  return files
}

async function buildBackupData(paths: Paths): Promise<BackupPayload> {
  const files = await collectFiles(paths)
  const contents: Record<string, string> = {}

  for (const file of files) {
    try {
      // Caminho absoluto: e o que o Swift escreve. A restauracao remapeia.
      contents[file] = (await fs.readFile(file)).toString('base64')
    } catch (e) {
      log.warn(`arquivo ignorado no backup (${basename(file)}): ${String(e)}`)
    }
  }

  return {
    files: contents,
    version: 2,
    app: 'open-maestri',
    createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    fileCount: Object.keys(contents).length,
  }
}

/** Remove os backups mais antigos, mantendo os `KEEP_COUNT` mais recentes. */
async function pruneOldBackups(dir: string): Promise<void> {
  const names = (await fs.readdir(dir).catch(() => [] as string[]))
    .filter((name) => name.endsWith(BACKUP_EXTENSION))
    .sort()
    .reverse()

  for (const name of names.slice(KEEP_COUNT)) {
    await fs.rm(join(dir, name), { force: true }).catch(() => undefined)
  }
}

/** Cria um backup e devolve o caminho. Nunca lanca: backup nao derruba o app. */
export async function createBackup(paths: Paths): Promise<string | undefined> {
  try {
    await fs.mkdir(paths.backupsDir, { recursive: true })
    const target = join(paths.backupsDir, backupFileName(new Date()))
    const payload = await buildBackupData(paths)
    // Escrita atomica: um backup truncado e pior que nenhum backup.
    await atomicWriteFile(target, JSON.stringify(payload))
    await pruneOldBackups(paths.backupsDir)
    log.info(`backup criado: ${basename(target)} (${payload.fileCount} arquivos)`)
    return target
  } catch (e) {
    log.error(`falha ao criar backup: ${String(e)}`)
    return undefined
  }
}

export async function listBackups(paths: Paths): Promise<Array<{ path: string; createdAt: Date }>> {
  const names = (await fs.readdir(paths.backupsDir).catch(() => [] as string[])).filter((name) =>
    name.endsWith(BACKUP_EXTENSION),
  )

  const out: Array<{ path: string; createdAt: Date }> = []
  for (const name of names) {
    const path = join(paths.backupsDir, name)
    try {
      const stat = await fs.stat(path)
      out.push({ path, createdAt: stat.mtime })
    } catch {
      // arquivo sumiu entre o readdir e o stat
    }
  }
  return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

export async function lastBackupDate(paths: Paths): Promise<Date | undefined> {
  return (await listBackups(paths))[0]?.createdAt
}

/**
 * Restaura de um `.omaestribak`. Devolve quantos arquivos foram gravados.
 *
 * O caminho gravado no backup e absoluto e pode ser de outra maquina (macOS,
 * outro usuario do Windows). Por isso o destino e recalculado a partir do
 * sufixo conhecido dentro do diretorio de dados atual — nunca do caminho cru,
 * que escreveria fora da arvore do app.
 */
export async function restoreBackup(paths: Paths, backupPath: string): Promise<number> {
  const raw = await readJsonFile(backupPath)
  if (!raw || typeof raw !== 'object') {
    log.error(`${basename(backupPath)} nao e um backup valido`)
    return 0
  }

  const payload = raw as Partial<BackupPayload>
  if (!payload.files || typeof payload.files !== 'object') {
    log.error(`${basename(backupPath)} esta no formato antigo (apenas lista de caminhos) — nao e restauravel`)
    return 0
  }

  let restored = 0
  for (const [sourcePath, base64] of Object.entries(payload.files)) {
    if (typeof base64 !== 'string') continue
    const destination = remapPath(paths, sourcePath)
    if (!destination) {
      log.warn(`caminho fora do layout conhecido, ignorado: ${sourcePath}`)
      continue
    }
    try {
      await atomicWriteFile(destination, Buffer.from(base64, 'base64').toString('utf8'))
      restored++
    } catch (e) {
      log.error(`falha ao restaurar ${sourcePath}: ${String(e)}`)
    }
  }

  log.info(`${restored}/${Object.keys(payload.files).length} arquivos restaurados de ${basename(backupPath)}`)
  return restored
}

/**
 * Traduz o caminho de origem (de qualquer maquina) para um caminho dentro do
 * diretorio de dados atual. Devolve `undefined` para o que nao se encaixa.
 */
export function remapPath(paths: Paths, sourcePath: string): string | undefined {
  const normalized = sourcePath.replace(/\\/g, '/')

  // worknspaces/<UUID>/workspace.json
  const workspace = normalized.match(/workspaces\/([^/]+)\/workspace\.json$/i)
  if (workspace?.[1]) return paths.workspaceJson(workspace[1])

  // workspaces/<UUID>/notes/<arquivo>.md
  const note = normalized.match(/workspaces\/([^/]+)\/notes\/(.+\.md)$/i)
  if (note?.[1] && note[2]) return paths.noteFile(note[1], note[2])

  // roles/<id>/<arquivo>
  const role = normalized.match(/roles\/([^/]+)\/([^/]+)$/i)
  if (role?.[1] && role[2]) return join(paths.rolesDir, role[1], role[2])

  const known: Array<[RegExp, string]> = [
    [/manifest\.json$/i, paths.manifest],
    [/app-state\.json$/i, paths.appState],
    [/preferences\.json$/i, paths.preferences],
    [/routines\.json$/i, paths.routines],
    [/sidebar-layout\.json$/i, paths.sidebarLayout],
  ]
  for (const [pattern, target] of known) {
    if (pattern.test(normalized)) return target
  }

  // Nada conhecido: devolver o proprio caminho seria escrever fora da arvore.
  return undefined
}

export interface BackupScheduler {
  stop(): void
}

/** Agenda backup horario. O timer e `unref`: nao segura o app aberto. */
export function startBackupScheduler(paths: Paths): BackupScheduler {
  const timer = setInterval(() => {
    void createBackup(paths)
  }, BACKUP_INTERVAL_SECONDS * 1000)
  timer.unref?.()
  log.info(`backup automatico a cada ${BACKUP_INTERVAL_SECONDS / 60} min`)

  return {
    stop: () => clearInterval(timer),
  }
}

/** Caminho relativo, usado apenas em log. */
export function describeBackupPath(paths: Paths, path: string): string {
  return relative(paths.root, path)
}
