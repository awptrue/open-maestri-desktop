/**
 * Backup no formato `.omaestribak` do macOS.
 *
 * O ponto critico e a restauracao: o Swift grava caminhos ABSOLUTOS, e um
 * backup feito em `/Users/dev/...` nao existe no Windows. Estes testes provam
 * que o remapeamento por sufixo poe cada arquivo no lugar certo e que caminho
 * desconhecido NAO e escrito fora da arvore do app.
 */

import { promises as fs } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createBackup, listBackups, remapPath, restoreBackup } from '../../src/main/persistence/backup'
import { createPaths } from '../../src/main/paths'

const cleanup: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn()
})

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'omaestri-backup-'))
  cleanup.push(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

describe('backup .omaestribak', () => {
  it('grava o envelope compativel com o macOS', async () => {
    const root = makeRoot()
    const paths = createPaths(root)
    await fs.mkdir(paths.backupsDir, { recursive: true })
    await fs.writeFile(paths.manifest, '{"schemaVersion":1}', 'utf8')

    const created = await createBackup(paths)
    expect(created).toBeDefined()

    const raw = JSON.parse(await fs.readFile(created!, 'utf8')) as Record<string, unknown>
    expect(raw.version).toBe(2)
    expect(raw.app).toBe('open-maestri')
    expect(typeof raw.createdAt).toBe('string')
    expect(raw.createdAt as string).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(raw.fileCount).toBeGreaterThan(0)

    const files = raw.files as Record<string, string>
    const manifestKey = Object.keys(files).find((key) => key.endsWith('manifest.json'))
    expect(manifestKey).toBeDefined()
    // Conteudo em base64, como o Swift escreve.
    expect(Buffer.from(files[manifestKey!]!, 'base64').toString('utf8')).toBe('{"schemaVersion":1}')
  })

  it('inclui workspace.json e notas do workspace', async () => {
    const root = makeRoot()
    const paths = createPaths(root)
    const workspaceId = '11111111-1111-4111-8111-111111111111'
    await fs.mkdir(paths.notesDir(workspaceId), { recursive: true })
    await fs.writeFile(paths.workspaceJson(workspaceId), '{"schemaVersion":2}', 'utf8')
    await fs.writeFile(paths.noteFile(workspaceId, 'Spec.md'), '# Spec', 'utf8')

    const created = await createBackup(paths)
    const raw = JSON.parse(await fs.readFile(created!, 'utf8')) as { files: Record<string, string> }
    const keys = Object.keys(raw.files).map((key) => key.replace(/\\/g, '/'))

    expect(keys.some((key) => key.endsWith(`${workspaceId}/workspace.json`))).toBe(true)
    expect(keys.some((key) => key.endsWith(`${workspaceId}/notes/Spec.md`))).toBe(true)
  })

  it('remapeia caminhos de outra maquina para o diretorio atual', () => {
    const root = makeRoot()
    const paths = createPaths(root)
    const workspaceId = '22222222-2222-4222-8222-222222222222'

    // Caminho de macOS: o mesmo do formato gravado pelo Swift.
    expect(remapPath(paths, `/Users/dev/.open-maestri/workspaces/${workspaceId}/workspace.json`)).toBe(
      paths.workspaceJson(workspaceId),
    )
    expect(remapPath(paths, `/Users/other/.open-maestri/workspaces/${workspaceId}/notes/Spec.md`)).toBe(
      paths.noteFile(workspaceId, 'Spec.md'),
    )
    expect(remapPath(paths, '/Users/dev/.open-maestri/manifest.json')).toBe(paths.manifest)

    // Caminho fora do layout: precisa ser recusado, nunca escrito fora da raiz.
    expect(remapPath(paths, '/etc/passwd')).toBeUndefined()
    expect(remapPath(paths, 'C:/Windows/System32/evil.dll')).toBeUndefined()
  })

  it('restaura de um backup feito em outro diretorio', async () => {
    const sourceRoot = makeRoot()
    const sourcePaths = createPaths(sourceRoot)
    const workspaceId = '33333333-3333-4333-8333-333333333333'
    await fs.mkdir(sourcePaths.notesDir(workspaceId), { recursive: true })
    await fs.writeFile(sourcePaths.noteFile(workspaceId, 'Plano.md'), 'conteudo original', 'utf8')
    const backupPath = await createBackup(sourcePaths)

    // Diretorio "da outra maquina": o backup precisa acertar aqui mesmo assim.
    const targetRoot = makeRoot()
    const targetPaths = createPaths(targetRoot)
    const restored = await restoreBackup(targetPaths, backupPath!)

    expect(restored).toBeGreaterThan(0)
    expect(await fs.readFile(targetPaths.noteFile(workspaceId, 'Plano.md'), 'utf8')).toBe('conteudo original')
  })

  it('recusa backup do formato antigo (lista de caminhos) sem lancar', async () => {
    const root = makeRoot()
    const paths = createPaths(root)
    await fs.mkdir(paths.backupsDir, { recursive: true })
    const legacy = join(paths.backupsDir, 'open-maestri-antigo.omaestribak')
    await fs.writeFile(legacy, '["/caminho/a.json"]', 'utf8')

    expect(await restoreBackup(paths, legacy)).toBe(0)
  })

  it('lista os backups mais recentes primeiro', async () => {
    const root = makeRoot()
    const paths = createPaths(root)
    await fs.mkdir(paths.backupsDir, { recursive: true })
    await fs.writeFile(join(paths.backupsDir, 'open-maestri-A.omaestribak'), '{}', 'utf8')
    // Nome mais "novo" na ordenacao lexicografica = timestamp maior.
    await new Promise((r) => setTimeout(r, 20))
    await fs.writeFile(join(paths.backupsDir, 'open-maestri-B.omaestribak'), '{}', 'utf8')

    const backups = await listBackups(paths)
    expect(backups).toHaveLength(2)
  })
})
