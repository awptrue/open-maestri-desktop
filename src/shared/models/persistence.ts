/**
 * `manifest.json`, `app-state.json` e `preferences.json`.
 *
 * Ver AppState+Models.swift e Preferences.swift. Regra de escrita igual ao
 * workspace.json: datas sem fração, UUIDs maiúsculos, opcionais omitidos.
 */

import {
  APP_STATE_SCHEMA_VERSION,
  AUTOSAVE_INTERVAL_SECONDS,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  MANIFEST_SCHEMA_VERSION,
  NOTE_DEFAULT_COLOR,
  PREFERENCES_SCHEMA_VERSION,
} from '../constants'
import {
  asRecord,
  decodeDateOptional,
  encodeDate,
  optionalUuid,
  readArray,
  readBool,
  readNumber,
  readString,
  requireUuid,
} from './codec'
import type { AgentType } from './node-content'

// ---------------------------------------------------------------------------
// app-state.json (schemaVersion 1, type "appState")
// ---------------------------------------------------------------------------

export interface AppStateData {
  schemaVersion: number
  type: 'appState'
  activeWorkspaceId?: string
  hasCompletedOnboarding: boolean
  hasSeenFloorOnboarding: boolean
  cleanShutdown: boolean
  lastOpenedAt?: Date
  recentWorkspaceIds: string[]
}

export function defaultAppState(): AppStateData {
  return {
    schemaVersion: APP_STATE_SCHEMA_VERSION,
    type: 'appState',
    hasCompletedOnboarding: false,
    hasSeenFloorOnboarding: false,
    cleanShutdown: true,
    recentWorkspaceIds: [],
  }
}

export function decodeAppState(raw: unknown): AppStateData {
  const o = asRecord(raw, 'appState')
  const state: AppStateData = {
    schemaVersion: readNumber(o, 'schemaVersion', APP_STATE_SCHEMA_VERSION),
    type: 'appState',
    hasCompletedOnboarding: readBool(o, 'hasCompletedOnboarding', false),
    hasSeenFloorOnboarding: readBool(o, 'hasSeenFloorOnboarding', false),
    cleanShutdown: readBool(o, 'cleanShutdown', true),
    recentWorkspaceIds: readArray(o, 'recentWorkspaceIds')
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.toUpperCase()),
  }
  const active = optionalUuid(o.activeWorkspaceId, 'activeWorkspaceId')
  if (active !== undefined) state.activeWorkspaceId = active
  const lastOpened = decodeDateOptional(o.lastOpenedAt)
  if (lastOpened !== undefined) state.lastOpenedAt = lastOpened
  return state
}

export function encodeAppState(state: AppStateData): Record<string, unknown> {
  const out: Record<string, unknown> = {
    schemaVersion: state.schemaVersion,
    type: state.type,
    hasCompletedOnboarding: state.hasCompletedOnboarding,
    hasSeenFloorOnboarding: state.hasSeenFloorOnboarding,
    cleanShutdown: state.cleanShutdown,
    recentWorkspaceIds: state.recentWorkspaceIds,
  }
  if (state.activeWorkspaceId !== undefined) out.activeWorkspaceId = state.activeWorkspaceId
  if (state.lastOpenedAt !== undefined) out.lastOpenedAt = encodeDate(state.lastOpenedAt)
  return out
}

// ---------------------------------------------------------------------------
// manifest.json
// ---------------------------------------------------------------------------

export type WorkspaceColor = 'blue' | 'red' | 'green' | 'orange' | 'purple' | 'pink' | 'cyan' | 'yellow' | 'rainbow'

export const WORKSPACE_COLORS: WorkspaceColor[] = [
  'blue',
  'red',
  'green',
  'orange',
  'purple',
  'pink',
  'cyan',
  'yellow',
  'rainbow',
]

export interface WorkspaceEntry {
  id: string
  name: string
  workingDirectory: string
  icon: string
  color: string
  isPinned: boolean
  locationType: string
  createdAt: Date
  lastOpenedAt?: Date
}

export interface WorkspaceManifest {
  schemaVersion: number
  type: 'appState'
  app: string
  appVersion: string
  dataFormat: number
  workspaces: WorkspaceEntry[]
  files: Record<string, string>
}

export function defaultManifest(): WorkspaceManifest {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    type: 'appState',
    app: 'open-maestri',
    appVersion: '1.0.0',
    dataFormat: 2,
    workspaces: [],
    files: {},
  }
}

export function decodeWorkspaceEntry(raw: unknown): WorkspaceEntry | undefined {
  try {
    const o = asRecord(raw, 'workspaceEntry')
    const entry: WorkspaceEntry = {
      id: requireUuid(o.id, 'workspace.id'),
      name: readString(o, 'name', 'Workspace'),
      workingDirectory: readString(o, 'workingDirectory', ''),
      icon: readString(o, 'icon', 'folder'),
      color: readString(o, 'color', 'blue'),
      isPinned: readBool(o, 'isPinned', false),
      locationType: readString(o, 'locationType', 'local'),
      createdAt: decodeDateOptional(o.createdAt) ?? new Date(),
    }
    const lastOpenedAt = decodeDateOptional(o.lastOpenedAt)
    if (lastOpenedAt !== undefined) entry.lastOpenedAt = lastOpenedAt
    return entry
  } catch {
    return undefined
  }
}

export function encodeWorkspaceEntry(entry: WorkspaceEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: entry.id,
    name: entry.name,
    workingDirectory: entry.workingDirectory,
    icon: entry.icon,
    color: entry.color,
    isPinned: entry.isPinned,
    locationType: entry.locationType,
    createdAt: encodeDate(entry.createdAt),
  }
  if (entry.lastOpenedAt !== undefined) out.lastOpenedAt = encodeDate(entry.lastOpenedAt)
  return out
}

export function decodeManifest(raw: unknown): WorkspaceManifest {
  const o = asRecord(raw, 'manifest')
  const filesRaw = o.files
  const files: Record<string, string> = {}
  if (typeof filesRaw === 'object' && filesRaw !== null && !Array.isArray(filesRaw)) {
    for (const [k, v] of Object.entries(filesRaw as Record<string, unknown>)) {
      if (typeof v === 'string') files[k] = v
    }
  }
  return {
    schemaVersion: readNumber(o, 'schemaVersion', MANIFEST_SCHEMA_VERSION),
    type: 'appState',
    app: readString(o, 'app', 'open-maestri'),
    appVersion: readString(o, 'appVersion', '1.0.0'),
    dataFormat: readNumber(o, 'dataFormat', 2),
    workspaces: readArray(o, 'workspaces')
      .map(decodeWorkspaceEntry)
      .filter((e): e is WorkspaceEntry => e !== undefined),
    files,
  }
}

export function encodeManifest(manifest: WorkspaceManifest): Record<string, unknown> {
  return {
    schemaVersion: manifest.schemaVersion,
    type: manifest.type,
    app: manifest.app,
    appVersion: manifest.appVersion,
    dataFormat: manifest.dataFormat,
    workspaces: manifest.workspaces.map(encodeWorkspaceEntry),
    files: manifest.files,
  }
}

// ---------------------------------------------------------------------------
// preferences.json
// ---------------------------------------------------------------------------

export interface AgentPreset {
  id: string
  name: string
  command: string
  icon: string
  agentType: AgentType
  color: string
  isActive: boolean
  isBuiltIn: boolean
}

export interface RolePreset {
  id: string
  name: string
  prompt: string
  color: string
  icon: string
}

export interface SkillPath {
  id: string
  name: string
  path: string
  icon: string
  isActive: boolean
  isBuiltIn: boolean
}

export interface KeyBinding {
  command: boolean
  control: boolean
  option: boolean
  shift: boolean
  keyCode: string
}

export interface ShortcutConfig {
  customKeys: Record<string, string>
  nodeJumpModifier: KeyBinding
  connectShortcut: KeyBinding
  nextTerminalShortcut: KeyBinding
  prevTerminalShortcut: KeyBinding
  nextWorkspaceShortcut: KeyBinding
  prevWorkspaceShortcut: KeyBinding
  workspaceJumpModifier: KeyBinding
  zoomToggleShortcut: KeyBinding
  zoomScrollModifier: KeyBinding
  scrollSwitchModifier: KeyBinding
  tileModifier: KeyBinding
  panToggleShortcut: KeyBinding
  autoScrollLockShortcut: KeyBinding
  floorOverviewShortcut: KeyBinding
  filterShortcut: KeyBinding
}

export interface Preferences {
  schemaVersion: number
  agentPresets: AgentPreset[]
  rolePresets: RolePreset[]
  skillPaths: SkillPath[]
  terminalFontFamily: string
  terminalFontSize: number
  terminalTheme: string
  canvasBackground: string
  defaultNoteColor: string
  preferredIDE: string
  language: string
  shortcuts: ShortcutConfig
  sshEnabled: boolean
  sshTunnelPort: number
  sshHost: string
  sshUser: string
  sshPort: number
  sshScriptPath: string
  sshAddToPath: boolean
  metalRendererEnabled: boolean
  scrollbackMemoryLimit: boolean
  optionAsMeta: boolean
  autosaveIntervalSeconds: number
}

function kb(
  keyCode: string,
  mods: { command?: boolean; control?: boolean; option?: boolean; shift?: boolean } = {},
): KeyBinding {
  return {
    command: mods.command ?? false,
    control: mods.control ?? false,
    option: mods.option ?? false,
    shift: mods.shift ?? false,
    keyCode,
  }
}

export function defaultShortcuts(): ShortcutConfig {
  return {
    customKeys: {},
    nodeJumpModifier: kb('command', { command: true }),
    connectShortcut: kb('l', { command: true }),
    nextTerminalShortcut: kb('tab', { control: true }),
    prevTerminalShortcut: kb('tab', { control: true, shift: true }),
    nextWorkspaceShortcut: kb('arrowdown', { command: true }),
    prevWorkspaceShortcut: kb('arrowup', { command: true }),
    workspaceJumpModifier: kb('command', { command: true }),
    zoomToggleShortcut: kb('backslash', { command: true }),
    zoomScrollModifier: kb('command', { command: true }),
    scrollSwitchModifier: kb('command', { command: true }),
    tileModifier: kb('command', { command: true }),
    panToggleShortcut: kb('h'),
    autoScrollLockShortcut: kb('b', { command: true, shift: true }),
    floorOverviewShortcut: kb('backslash', { command: true, shift: true }),
    filterShortcut: kb('p', { command: true }),
  }
}

/**
 * Os presets padrão do macOS. Os comandos são idênticos no Windows porque
 * `claude`, `codex`, `gemini` e `opencode` são CLIs multiplataforma; apenas o
 * shell padrão muda (resolvido em `terminal/shell-resolver.ts`).
 */
export function defaultAgentPresets(): AgentPreset[] {
  return [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Claude Code',
      command: 'claude',
      icon: 'seal',
      agentType: 'claude_code',
      color: '#007AFF',
      isActive: true,
      isBuiltIn: true,
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Codex',
      command: 'codex',
      icon: 'brain',
      agentType: 'codex',
      color: '#5856D6',
      isActive: true,
      isBuiltIn: true,
    },
    {
      id: '00000000-0000-4000-8000-000000000003',
      name: 'Gemini CLI',
      command: 'gemini',
      icon: 'sparkle',
      agentType: 'gemini_cli',
      color: '#34C759',
      isActive: true,
      isBuiltIn: true,
    },
    {
      id: '00000000-0000-4000-8000-000000000004',
      name: 'OpenCode',
      command: 'opencode',
      icon: 'rectangle.portrait',
      agentType: 'open_code',
      color: '#FF9500',
      isActive: true,
      isBuiltIn: true,
    },
    {
      id: '00000000-0000-4000-8000-000000000005',
      name: 'Shell',
      // Sem comando: no macOS `bash` existe, no Windows nao. Um shell generico
      // deve abrir o shell padrao da plataforma (pwsh), nao tentar executar
      // `bash` e falhar com "command not found".
      command: '',
      icon: 'terminal',
      agentType: 'generic_shell',
      color: '#8E8E93',
      isActive: true,
      isBuiltIn: true,
    },
  ]
}

export function defaultSkillPaths(): SkillPath[] {
  return [
    {
      id: '00000000-0000-4000-8000-000000000011',
      name: 'Claude Code',
      path: '~/.claude/skills',
      icon: 'gearshape',
      isActive: true,
      isBuiltIn: true,
    },
    {
      id: '00000000-0000-4000-8000-000000000012',
      name: 'Agent Skills',
      path: '~/.agents/skills',
      icon: 'doc.text',
      isActive: true,
      isBuiltIn: true,
    },
    {
      id: '00000000-0000-4000-8000-000000000013',
      name: 'Hermes',
      path: '~/.hermes/skills',
      icon: 'paperplane',
      isActive: true,
      isBuiltIn: true,
    },
    {
      id: '00000000-0000-4000-8000-000000000014',
      name: 'Antigravity',
      path: '~/.gemini/antigravity-cli/skills',
      icon: 'sparkle',
      isActive: true,
      isBuiltIn: true,
    },
  ]
}

export function defaultPreferences(): Preferences {
  return {
    schemaVersion: PREFERENCES_SCHEMA_VERSION,
    agentPresets: defaultAgentPresets(),
    rolePresets: [],
    skillPaths: defaultSkillPaths(),
    terminalFontFamily: DEFAULT_FONT_FAMILY,
    terminalFontSize: DEFAULT_FONT_SIZE,
    terminalTheme: 'dark',
    canvasBackground: 'dotGrid',
    defaultNoteColor: NOTE_DEFAULT_COLOR,
    preferredIDE: 'cursor',
    language: 'en',
    shortcuts: defaultShortcuts(),
    sshEnabled: false,
    sshTunnelPort: 7433,
    sshHost: '',
    sshUser: '',
    sshPort: 22,
    sshScriptPath: '~/.local/bin/omaestri',
    sshAddToPath: true,
    metalRendererEnabled: false,
    scrollbackMemoryLimit: false,
    optionAsMeta: false,
    autosaveIntervalSeconds: AUTOSAVE_INTERVAL_SECONDS,
  }
}

function decodeKeyBinding(value: unknown, fallback: KeyBinding): KeyBinding {
  if (typeof value !== 'object' || value === null) return fallback
  const o = value as Record<string, unknown>
  return {
    command: readBool(o, 'command', fallback.command),
    control: readBool(o, 'control', fallback.control),
    option: readBool(o, 'option', fallback.option),
    shift: readBool(o, 'shift', fallback.shift),
    keyCode: readString(o, 'keyCode', fallback.keyCode),
  }
}

function decodeShortcuts(value: unknown): ShortcutConfig {
  const base = defaultShortcuts()
  if (typeof value !== 'object' || value === null) return base
  const o = value as Record<string, unknown>

  const customKeys: Record<string, string> = {}
  const customRaw = o.customKeys
  if (typeof customRaw === 'object' && customRaw !== null && !Array.isArray(customRaw)) {
    for (const [k, v] of Object.entries(customRaw as Record<string, unknown>)) {
      if (typeof v === 'string') customKeys[k] = v
    }
  }

  return {
    customKeys,
    nodeJumpModifier: decodeKeyBinding(o.nodeJumpModifier, base.nodeJumpModifier),
    connectShortcut: decodeKeyBinding(o.connectShortcut, base.connectShortcut),
    nextTerminalShortcut: decodeKeyBinding(o.nextTerminalShortcut, base.nextTerminalShortcut),
    prevTerminalShortcut: decodeKeyBinding(o.prevTerminalShortcut, base.prevTerminalShortcut),
    nextWorkspaceShortcut: decodeKeyBinding(o.nextWorkspaceShortcut, base.nextWorkspaceShortcut),
    prevWorkspaceShortcut: decodeKeyBinding(o.prevWorkspaceShortcut, base.prevWorkspaceShortcut),
    workspaceJumpModifier: decodeKeyBinding(o.workspaceJumpModifier, base.workspaceJumpModifier),
    zoomToggleShortcut: decodeKeyBinding(o.zoomToggleShortcut, base.zoomToggleShortcut),
    zoomScrollModifier: decodeKeyBinding(o.zoomScrollModifier, base.zoomScrollModifier),
    scrollSwitchModifier: decodeKeyBinding(o.scrollSwitchModifier, base.scrollSwitchModifier),
    tileModifier: decodeKeyBinding(o.tileModifier, base.tileModifier),
    panToggleShortcut: decodeKeyBinding(o.panToggleShortcut, base.panToggleShortcut),
    autoScrollLockShortcut: decodeKeyBinding(o.autoScrollLockShortcut, base.autoScrollLockShortcut),
    floorOverviewShortcut: decodeKeyBinding(o.floorOverviewShortcut, base.floorOverviewShortcut),
    filterShortcut: decodeKeyBinding(o.filterShortcut, base.filterShortcut),
  }
}

function decodeAgentPreset(raw: unknown): AgentPreset | undefined {
  try {
    const o = asRecord(raw, 'agentPreset')
    const t = o.agentType
    const agentType: AgentType =
      t === 'claude_code' || t === 'codex' || t === 'gemini_cli' || t === 'open_code' ? t : 'generic_shell'
    return {
      id: requireUuid(o.id, 'agentPreset.id'),
      name: readString(o, 'name', 'Agent'),
      command: readString(o, 'command', ''),
      icon: readString(o, 'icon', 'terminal'),
      agentType,
      color: readString(o, 'color', '#8E8E93'),
      isActive: readBool(o, 'isActive', true),
      isBuiltIn: readBool(o, 'isBuiltIn', false),
    }
  } catch {
    return undefined
  }
}

function decodeSkillPath(raw: unknown): SkillPath | undefined {
  try {
    const o = asRecord(raw, 'skillPath')
    return {
      id: requireUuid(o.id, 'skillPath.id'),
      name: readString(o, 'name', 'Skills'),
      path: readString(o, 'path', ''),
      icon: readString(o, 'icon', 'gearshape'),
      isActive: readBool(o, 'isActive', true),
      isBuiltIn: readBool(o, 'isBuiltIn', false),
    }
  } catch {
    return undefined
  }
}

function decodeRolePreset(raw: unknown): RolePreset | undefined {
  try {
    const o = asRecord(raw, 'rolePreset')
    return {
      id: requireUuid(o.id, 'rolePreset.id'),
      name: readString(o, 'name', 'Role'),
      prompt: readString(o, 'prompt', ''),
      color: readString(o, 'color', '#8E8E93'),
      icon: readString(o, 'icon', 'person'),
    }
  } catch {
    return undefined
  }
}

export function decodePreferences(raw: unknown): Preferences {
  const o = asRecord(raw, 'preferences')
  const base = defaultPreferences()

  const presets = readArray(o, 'agentPresets')
    .map(decodeAgentPreset)
    .filter((p): p is AgentPreset => p !== undefined)
  const skills = readArray(o, 'skillPaths')
    .map(decodeSkillPath)
    .filter((p): p is SkillPath => p !== undefined)
  const roles = readArray(o, 'rolePresets')
    .map(decodeRolePreset)
    .filter((p): p is RolePreset => p !== undefined)

  return {
    schemaVersion: readNumber(o, 'schemaVersion', PREFERENCES_SCHEMA_VERSION),
    agentPresets: presets.length > 0 ? presets : base.agentPresets,
    rolePresets: roles,
    skillPaths: skills.length > 0 ? skills : base.skillPaths,
    terminalFontFamily: readString(o, 'terminalFontFamily', base.terminalFontFamily),
    terminalFontSize: readNumber(o, 'terminalFontSize', base.terminalFontSize),
    terminalTheme: readString(o, 'terminalTheme', base.terminalTheme),
    canvasBackground: readString(o, 'canvasBackground', base.canvasBackground),
    defaultNoteColor: readString(o, 'defaultNoteColor', base.defaultNoteColor),
    preferredIDE: readString(o, 'preferredIDE', base.preferredIDE),
    language: readString(o, 'language', base.language),
    shortcuts: decodeShortcuts(o.shortcuts),
    sshEnabled: readBool(o, 'sshEnabled', base.sshEnabled),
    sshTunnelPort: readNumber(o, 'sshTunnelPort', base.sshTunnelPort),
    sshHost: readString(o, 'sshHost', base.sshHost),
    sshUser: readString(o, 'sshUser', base.sshUser),
    sshPort: readNumber(o, 'sshPort', base.sshPort),
    sshScriptPath: readString(o, 'sshScriptPath', base.sshScriptPath),
    sshAddToPath: readBool(o, 'sshAddToPath', base.sshAddToPath),
    metalRendererEnabled: readBool(o, 'metalRendererEnabled', base.metalRendererEnabled),
    scrollbackMemoryLimit: readBool(o, 'scrollbackMemoryLimit', base.scrollbackMemoryLimit),
    optionAsMeta: readBool(o, 'optionAsMeta', base.optionAsMeta),
    autosaveIntervalSeconds: readNumber(o, 'autosaveIntervalSeconds', base.autosaveIntervalSeconds),
  }
}

function encodeAgentPreset(p: AgentPreset): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    command: p.command,
    icon: p.icon,
    agentType: p.agentType,
    color: p.color,
    isActive: p.isActive,
    isBuiltIn: p.isBuiltIn,
  }
}

function encodeSkillPath(p: SkillPath): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    path: p.path,
    icon: p.icon,
    isActive: p.isActive,
    isBuiltIn: p.isBuiltIn,
  }
}

function encodeRolePreset(p: RolePreset): Record<string, unknown> {
  return { id: p.id, name: p.name, prompt: p.prompt, color: p.color, icon: p.icon }
}

export function encodePreferences(prefs: Preferences): Record<string, unknown> {
  return {
    schemaVersion: prefs.schemaVersion,
    agentPresets: prefs.agentPresets.map(encodeAgentPreset),
    rolePresets: prefs.rolePresets.map(encodeRolePreset),
    skillPaths: prefs.skillPaths.map(encodeSkillPath),
    terminalFontFamily: prefs.terminalFontFamily,
    terminalFontSize: prefs.terminalFontSize,
    terminalTheme: prefs.terminalTheme,
    canvasBackground: prefs.canvasBackground,
    defaultNoteColor: prefs.defaultNoteColor,
    preferredIDE: prefs.preferredIDE,
    language: prefs.language,
    shortcuts: prefs.shortcuts,
    sshEnabled: prefs.sshEnabled,
    sshTunnelPort: prefs.sshTunnelPort,
    sshHost: prefs.sshHost,
    sshUser: prefs.sshUser,
    sshPort: prefs.sshPort,
    sshScriptPath: prefs.sshScriptPath,
    sshAddToPath: prefs.sshAddToPath,
    metalRendererEnabled: prefs.metalRendererEnabled,
    scrollbackMemoryLimit: prefs.scrollbackMemoryLimit,
    optionAsMeta: prefs.optionAsMeta,
    autosaveIntervalSeconds: prefs.autosaveIntervalSeconds,
  }
}


