/**
 * SkillInjector — porte de `Sources/Connection/SkillInjector.swift`.
 *
 * Escreve a skill `open-maestri` em cada `skillPaths` ativo das preferencias
 * (`~/.claude/skills`, `~/.agents/skills`, ...). E assim que o agente descobre
 * que existe um CLI `omaestri` e como falar com os outros nos do canvas.
 *
 * Diferenca deliberada em relacao ao original: o macOS instala 3 skills
 * (`open-maestri`, `open-maestri-portal`, `open-maestri-manager`). Aqui so a
 * primeira, porque portal e manager ainda nao existem nesta versao — instalar a
 * skill do portal faria o agente tentar comandos que respondem `error:`.
 *
 * Regra de escrita: nunca sobrescrever skill existente, e sim atualizar quando o
 * conteudo embutido mudou. Sem isso, uma correcao no texto nunca chegaria a
 * quem ja tem o arquivo da versao anterior.
 */

import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Preferences, SkillPath } from '@shared/models/persistence'

import { createLogger } from '../logger'

const log = createLogger('SkillInjector')

export const SKILL_DIR_NAME = 'open-maestri'
export const SKILL_FILE_NAME = 'SKILL.md'

/** Marcador de versao: so o que esta entre estes comentarios e gerenciado. */
const VERSION_MARKER = 'omaestri-skill:'

const SKILL_VERSION = '2'

/**
 * Conteudo da skill. Descreve APENAS os comandos implementados nesta versao.
 * `portal` e `manager` ficam de fora de proposito (ver comentario do modulo).
 */
export const OPEN_MAESTRI_SKILL = `---
name: open-maestri
description: Send messages to connected AI agents on the open-maestri canvas and get their responses. Also read and write connected sticky notes. Use when the user's intent is to collaborate with another agent on the canvas. Look for actions like 'ask [name] to...', 'tell [name] to...', 'check on [name]', or 'create/update a note'.
user-invocable: false
---

<!-- ${VERSION_MARKER}${SKILL_VERSION} -->

# open-maestri Inter-Agent Communication

You're running inside open-maestri, a spatial workspace with other coding agents and sticky notes nearby.
Connected agents can exchange prompts and responses through the \`omaestri\` CLI.
Connected notes can be read and written through the \`omaestri\` CLI.

## Commands

- \`omaestri list\`
  list workspace terminals, their connections, and note filenames

- \`omaestri context\`
  show which agents and notes YOUR terminal is connected to, plus the ask hint.
  Run this first when you are unsure who you can reach.

- \`omaestri ask "Agent Name" "your prompt"\`
  send a prompt to a connected agent and get the response

- \`omaestri check "Agent Name" [lines]\`
  read the agent's current terminal output on demand (default 60 lines)

- \`omaestri note read "Note Name"\`
  read the full note

- \`omaestri note write "Note Name" "content"\`
  replace a note's content entirely

- \`omaestri note edit "Note Name" "old text" "new text"\`
  replace a substring within a note

- \`omaestri notify "message"\`
  show a system notification to the person using the app

The \`omaestri\` CLI is pre-installed and available on PATH inside open-maestri terminals.
If \`omaestri\` is not found on PATH (custom shell setups that reset PATH), use \`"$MAESTRI_CLI"\` instead — this environment variable always points to the full binary path.

Always run \`omaestri list\` first to get the exact agent and note names.

## Scope

\`ask\` and \`check\` only reach terminals that are CONNECTED to yours on the canvas.
If a name is not found, run \`omaestri context\` to see who you can actually reach.

## Timeouts

The server waits up to 30 seconds for the target terminal to become idle, then returns up to 200 lines of current output. An idle terminal does not prove the agent finished.

If the response is partial or the wait times out, do NOT re-send the prompt. Run \`omaestri check "Agent Name"\` to see their progress. Never interrupt an agent that is still working, and do not edit files that the other agent is actively modifying — wait for them to finish first.

## Connected Notes

Use the exact filename shown by \`omaestri list\` (including \`.md\`) or its short name without the extension. \`omaestri note read\` returns the full note without line numbers or pagination.
Use \`omaestri note write\` to replace the entire note content, and \`omaestri note edit\` for surgical in-place replacements.

## Diagnostics

Run \`omaestri debug\` to diagnose connection or setup issues. When a command returns \`error: ...\`, read the message — it says exactly what failed.
`

/** Expande `~/...` sem depender de shell. */
export function expandHome(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return join(homedir(), trimmed.slice(2))
  }
  return trimmed
}

export function skillFilePath(skillRoot: string): string {
  return join(skillRoot, SKILL_DIR_NAME, SKILL_FILE_NAME)
}

/** true quando o arquivo ja tem o conteudo atual (nada a fazer). */
function isUpToDate(existing: string): boolean {
  return existing.includes(`${VERSION_MARKER}${SKILL_VERSION}`) && existing === OPEN_MAESTRI_SKILL
}

export interface SkillInstallResult {
  path: string
  status: 'installed' | 'updated' | 'unchanged' | 'failed'
  error?: string
}

async function installTo(skillRoot: string): Promise<SkillInstallResult> {
  const target = skillFilePath(skillRoot)
  let existing: string | undefined
  try {
    existing = await fs.readFile(target, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { path: target, status: 'failed', error: (e as Error).message }
    }
  }

  if (existing !== undefined && isUpToDate(existing)) {
    return { path: target, status: 'unchanged' }
  }

  try {
    await fs.mkdir(join(skillRoot, SKILL_DIR_NAME), { recursive: true })
    await fs.writeFile(target, OPEN_MAESTRI_SKILL, 'utf8')
    return { path: target, status: existing === undefined ? 'installed' : 'updated' }
  } catch (e) {
    return { path: target, status: 'failed', error: (e as Error).message }
  }
}

/**
 * Instala a skill em todos os `skillPaths` ativos.
 *
 * Nunca lanca: uma pasta de skill sem permissao nao pode derrubar o boot.
 */
export async function installSkills(preferences: Preferences): Promise<SkillInstallResult[]> {
  const active = preferences.skillPaths.filter((skill: SkillPath) => skill.isActive && skill.path.trim() !== '')
  const results: SkillInstallResult[] = []

  for (const skillPath of active) {
    const root = expandHome(skillPath.path)
    const result = await installTo(root)
    results.push(result)

    if (result.status === 'failed') {
      log.warn(`skill nao instalada em ${result.path}: ${result.error ?? 'erro desconhecido'}`)
    } else if (result.status !== 'unchanged') {
      log.info(`skill ${result.status} em ${result.path}`)
    }
  }

  return results
}
