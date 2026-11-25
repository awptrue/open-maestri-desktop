/**
 * Resolucao de caminhos do diretorio de dados.
 *
 * Compartilha o MESMO layout do open-maestri do macOS:
 *   ~/.open-maestri/            (macOS)
 *   %USERPROFILE%\.open-maestri (Windows)
 *
 * `OPEN_MAESTRI_HOME` permite apontar para outro diretorio (usado nos testes e
 * para abrir um workspace em outro disco).
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import { APP_DATA_DIRECTORY_NAME, CLI_PIPE_PATH } from '@shared/constants'

export interface Paths {
  root: string
  manifest: string
  preferences: string
  appState: string
  routines: string
  sidebarLayout: string
  logsDir: string
  runDir: string
  backupsDir: string
  pipePath: string
  binDir: string
  workspacesDir: string
  rolesDir: string
  workspaceDir(id: string): string
  workspaceJson(id: string): string
  notesDir(id: string): string
  terminalsDir(id: string): string
  scrollbackFile(workspaceId: string, terminalId: string): string
  noteFile(workspaceId: string, fileName: string): string
}

export function resolveRoot(): string {
  const override = process.env.OPEN_MAESTRI_HOME?.trim()
  if (override) return override
  return join(homedir(), APP_DATA_DIRECTORY_NAME)
}

export function createPaths(root = resolveRoot()): Paths {
  const workspacesDir = join(root, 'workspaces')
  return {
    root,
    manifest: join(root, 'manifest.json'),
    preferences: join(root, 'preferences.json'),
    appState: join(root, 'app-state.json'),
    routines: join(root, 'routines.json'),
    sidebarLayout: join(root, 'sidebar-layout.json'),
    logsDir: join(root, 'logs'),
    runDir: join(root, 'run'),
    // Mesmo nome do macOS (`BackupManager.swift:43`): os .omaestribak ficam
    // lado a lado com o resto do estado, e o original os encontra la.
    backupsDir: join(root, 'backups'),
    pipePath: CLI_PIPE_PATH,
    binDir: join(root, 'bin'),
    workspacesDir,
    rolesDir: join(root, 'roles'),
    workspaceDir: (id) => join(workspacesDir, id.toUpperCase()),
    workspaceJson: (id) => join(workspacesDir, id.toUpperCase(), 'workspace.json'),
    notesDir: (id) => join(workspacesDir, id.toUpperCase(), 'notes'),
    terminalsDir: (id) => join(workspacesDir, id.toUpperCase(), 'terminals'),
    scrollbackFile: (workspaceId, terminalId) =>
      join(workspacesDir, workspaceId.toUpperCase(), 'terminals', `${terminalId.toUpperCase()}.scrollback`),
    noteFile: (workspaceId, fileName) =>
      join(workspacesDir, workspaceId.toUpperCase(), 'notes', sanitizeFileName(fileName)),
  }
}

/**
 * Mesma sanitizacao do macOS (`NoteFileManager.swift:119-123`): troca os
 * caracteres invalidos no Windows por `-`, para que nomes de nota criados no
 * macOS continuem abrindo aqui.
 */
export function sanitizeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '-')
}

/** Diretorio unico por instancia, para o pipe nao colidir entre usuarios. */
export function pipeNameForUser(): string {
  return 'omaestri-agent'
}
