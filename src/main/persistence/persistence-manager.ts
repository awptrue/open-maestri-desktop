/**
 * Persistencia do diretorio de dados.
 *
 * Espelha `Sources/Workspace/PersistenceManager.swift`:
 *  - leitura tolerante (arquivo ausente vira default, arquivo corrompido vira quarentena)
 *  - escrita atomica (`.tmp` + rename) com fila por arquivo
 *  - cache de preferencias em memoria
 *
 * NENHUM outro modulo pode escrever em `~/.open-maestri/` diretamente.
 */

import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import {
  decodeAppState,
  decodeManifest,
  decodePreferences,
  defaultAppState,
  defaultManifest,
  defaultPreferences,
  encodeAppState,
  encodeManifest,
  encodePreferences,
  type AppStateData,
  type Preferences,
  type WorkspaceManifest,
} from '@shared/models/persistence'
import {
  decodeWorkspaceDocument,
  encodeWorkspaceDocument,
  type WorkspaceDocument,
} from '@shared/models/workspace'

import { createLogger } from '../logger'
import { atomicWriteFile, readJsonFile, stringifyPretty } from './atomic'
import type { Paths } from '../paths'

const log = createLogger('Persistence')

/** Fila por caminho: duas gravacoes simultaneas do mesmo arquivo se atropelam. */
const tails = new Map<string, Promise<unknown>>()

function enqueue<T>(path: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(path) ?? Promise.resolve()
  // Dois handlers: uma falha anterior nao bloqueia a proxima gravacao nem
  // vira unhandled rejection.
  const next = previous.then(task, task)
  // A cauda guardada tolera falha, para a proxima gravacao ainda rodar.
  const tail: Promise<unknown> = next.then(
    () => undefined,
    () => undefined,
  )
  tails.set(path, tail)
  void tail.then(() => {
    // Remove apenas se ninguem enfileirou depois desta.
    if (tails.get(path) === tail) tails.delete(path)
  })
  return next
}

/**
 * Move um arquivo ilegivel para `*.corrupt-<timestamp>` em vez de apaga-lo ou
 * travar o boot. O usuario mantém a chance de recuperar manualmente.
 */
async function quarantine(path: string, reason: string): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = `${path}.corrupt-${stamp}`
  try {
    await fs.rename(path, target)
    log.warn(`${basename(path)} ilegivel (${reason}); movido para ${basename(target)}`)
  } catch (e) {
    log.error(`nao foi possivel mover ${basename(path)}: ${String(e)}`)
  }
}

async function readOr<T>(path: string, decode: (raw: unknown) => T, fallback: () => T, label: string): Promise<T> {
  let raw: unknown
  try {
    raw = await readJsonFile(path)
  } catch (e) {
    await quarantine(path, e instanceof Error ? e.message : 'JSON invalido')
    return fallback()
  }
  if (raw === undefined) return fallback()
  try {
    return decode(raw)
  } catch (e) {
    await quarantine(path, e instanceof Error ? e.message : 'decode falhou')
    log.warn(`${label} invalido; usando default`)
    return fallback()
  }
}

export class PersistenceManager {
  private preferenceCache: Preferences | undefined

  constructor(private readonly paths: Paths) {}

  // -------------------------------------------------------------------------
  // Diretorios
  // -------------------------------------------------------------------------

  async ensureRootDirs(): Promise<void> {
    await fs.mkdir(this.paths.root, { recursive: true })
    await Promise.all([
      fs.mkdir(this.paths.workspacesDir, { recursive: true }),
      fs.mkdir(this.paths.rolesDir, { recursive: true }),
      fs.mkdir(this.paths.logsDir, { recursive: true }),
    ])
  }

  async ensureWorkspaceDirs(workspaceId: string): Promise<void> {
    await Promise.all([
      fs.mkdir(this.paths.workspaceDir(workspaceId), { recursive: true }),
      fs.mkdir(this.paths.notesDir(workspaceId), { recursive: true }),
      fs.mkdir(this.paths.terminalsDir(workspaceId), { recursive: true }),
    ])
  }

  // -------------------------------------------------------------------------
  // app-state / manifest / preferences
  // -------------------------------------------------------------------------

  async loadAppState(): Promise<AppStateData> {
    return readOr(this.paths.appState, decodeAppState, defaultAppState, 'app-state.json')
  }

  async saveAppState(state: AppStateData): Promise<void> {
    const json = stringifyPretty(encodeAppState(state))
    await enqueue(this.paths.appState, () => atomicWriteFile(this.paths.appState, json))
  }

  async loadManifest(): Promise<WorkspaceManifest> {
    return readOr(this.paths.manifest, decodeManifest, defaultManifest, 'manifest.json')
  }

  async saveManifest(manifest: WorkspaceManifest): Promise<void> {
    const json = stringifyPretty(encodeManifest(manifest))
    await enqueue(this.paths.manifest, () => atomicWriteFile(this.paths.manifest, json))
  }

  async loadPreferences(): Promise<Preferences> {
    if (this.preferenceCache) return this.preferenceCache
    const prefs = await readOr(this.paths.preferences, decodePreferences, defaultPreferences, 'preferences.json')
    this.preferenceCache = prefs
    return prefs
  }

  async savePreferences(prefs: Preferences): Promise<void> {
    this.preferenceCache = prefs
    const json = stringifyPretty(encodePreferences(prefs))
    await enqueue(this.paths.preferences, () => atomicWriteFile(this.paths.preferences, json))
  }

  // -------------------------------------------------------------------------
  // workspace
  // -------------------------------------------------------------------------

  /**
   * Le um workspace. Devolve `undefined` quando o arquivo nao existe.
   * Arquivo corrompido vai para quarentena e o chamador decide o que fazer.
   */
  async loadWorkspace(workspaceId: string): Promise<WorkspaceDocument | undefined> {
    const path = this.paths.workspaceJson(workspaceId)
    let raw: unknown
    try {
      raw = await readJsonFile(path)
    } catch (e) {
      await quarantine(path, e instanceof Error ? e.message : 'JSON invalido')
      return undefined
    }
    if (raw === undefined) return undefined
    try {
      return decodeWorkspaceDocument(raw)
    } catch (e) {
      await quarantine(path, e instanceof Error ? e.message : 'decode falhou')
      return undefined
    }
  }

  async saveWorkspace(doc: WorkspaceDocument): Promise<void> {
    const path = this.paths.workspaceJson(doc.payload.id)
    await this.ensureWorkspaceDirs(doc.payload.id)
    const json = stringifyPretty(encodeWorkspaceDocument(doc))
    await enqueue(path, () => atomicWriteFile(path, json))
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const dir = this.paths.workspaceDir(workspaceId)
    await fs.rm(dir, { recursive: true, force: true })
  }

  // -------------------------------------------------------------------------
  // notas
  // -------------------------------------------------------------------------

  async readNote(workspaceId: string, fileName: string): Promise<string> {
    try {
      return await fs.readFile(this.paths.noteFile(workspaceId, fileName), 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw e
    }
  }

  /** Escrita atomica: uma nota truncada por queda de energia perde trabalho do usuario. */
  async writeNote(workspaceId: string, fileName: string, content: string): Promise<void> {
    const path = this.paths.noteFile(workspaceId, fileName)
    await fs.mkdir(dirname(path), { recursive: true })
    await enqueue(path, () => atomicWriteFile(path, content))
  }

  async deleteNote(workspaceId: string, fileName: string): Promise<void> {
    await fs.rm(this.paths.noteFile(workspaceId, fileName), { force: true })
  }

  async listNotes(workspaceId: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.paths.notesDir(workspaceId), { withFileTypes: true })
      return entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name)
    } catch {
      return []
    }
  }

  /** Caminho absoluto da nota, para logs e para o editor abrir. */
  notePath(workspaceId: string, fileName: string): string {
    return join(this.paths.notesDir(workspaceId), fileName)
  }
}
