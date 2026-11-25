import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  OPEN_MAESTRI_SKILL,
  expandHome,
  installSkills,
  skillFilePath,
} from '../../src/main/connection/skill-injector'
import { defaultPreferences, type SkillPath } from '../../src/shared/models/persistence'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'omaestri-skill-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function skillPath(path: string, isActive = true): SkillPath {
  return { id: path, name: path, path, icon: 'doc', isActive, isBuiltIn: false }
}

function prefs(...paths: SkillPath[]): ReturnType<typeof defaultPreferences> {
  return { ...defaultPreferences(), skillPaths: paths }
}

describe('expandHome', () => {
  it('expande ~ e ~/ sem tocar em caminho absoluto', () => {
    expect(expandHome('~')).toBe(homedir())
    expect(expandHome('~/.claude/skills')).toBe(join(homedir(), '.claude/skills'))
    expect(expandHome('  ~\\agents  ')).toBe(join(homedir(), 'agents'))
    expect(expandHome('C:\\skills')).toBe('C:\\skills')
  })
})

describe('installSkills', () => {
  it('grava a skill em cada destino ativo', async () => {
    const a = join(root, 'a')
    const b = join(root, 'b')

    const results = await installSkills(prefs(skillPath(a), skillPath(b)))

    expect(results.map((r) => r.status)).toEqual(['installed', 'installed'])
    expect(await readFile(skillFilePath(a), 'utf8')).toBe(OPEN_MAESTRI_SKILL)
    expect(await readFile(skillFilePath(b), 'utf8')).toBe(OPEN_MAESTRI_SKILL)
  })

  it('e idempotente: segunda chamada nao reescreve', async () => {
    const dir = join(root, 'skills')
    await installSkills(prefs(skillPath(dir)))
    const target = skillFilePath(dir)
    // Marca externa que so sobrevive se o arquivo NAO for reescrito.
    await writeFile(target, OPEN_MAESTRI_SKILL, 'utf8')
    const before = await readFile(target, 'utf8')

    const results = await installSkills(prefs(skillPath(dir)))

    expect(results[0]?.status).toBe('unchanged')
    expect(await readFile(target, 'utf8')).toBe(before)
  })

  it('atualiza skill de versao anterior', async () => {
    const dir = join(root, 'old')
    const target = skillFilePath(dir)
    await mkdir(join(dir, 'open-maestri'), { recursive: true })
    await writeFile(target, '<!-- omaestri-skill:0 -->\n# versao antiga\n', 'utf8')

    const results = await installSkills(prefs(skillPath(dir)))

    expect(results[0]?.status).toBe('updated')
    expect(await readFile(target, 'utf8')).toBe(OPEN_MAESTRI_SKILL)
  })

  it('ignora destino inativo e caminho vazio', async () => {
    const off = join(root, 'off')
    const results = await installSkills(prefs(skillPath(off, false), skillPath('   ')))

    expect(results).toEqual([])
    await expect(readFile(skillFilePath(off), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('nao lanca quando o destino nao pode ser criado', async () => {
    // Um arquivo no lugar do diretorio faz o mkdir falhar com ENOTDIR/EEXIST.
    const blocked = join(root, 'arquivo')
    await writeFile(blocked, 'x', 'utf8')

    const results = await installSkills(prefs(skillPath(join(blocked, 'skills'))))

    expect(results[0]?.status).toBe('failed')
    expect(results[0]?.error).toBeTruthy()
  })

  it('a skill embutida cita apenas comandos implementados', () => {
    expect(OPEN_MAESTRI_SKILL).toContain('omaestri ask')
    expect(OPEN_MAESTRI_SKILL).toContain('omaestri context')
    // Portal e manager ainda nao existem: cita-los faria o agente tentar
    // comandos que respondem `error:`.
    expect(OPEN_MAESTRI_SKILL).not.toContain('omaestri portal')
    expect(OPEN_MAESTRI_SKILL).not.toContain('omaestri recruit')
  })
})
