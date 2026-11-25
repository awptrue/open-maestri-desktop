import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function getCliDir(root = process.env.OPEN_MAESTRI_HOME ?? join(homedir(), '.open-maestri')): string {
  return join(root, 'bin')
}

export function resolveCliScriptPath(): string {
  return join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'cli', 'omaestri.js')
}

function quoteCmdPath(path: string): string {
  return `"${path.replace(/%/g, '%%')}"`
}

function quoteShellPath(path: string): string {
  return `'${path.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`
}

async function writeIfChanged(target: string, content: string): Promise<boolean> {
  const expected = Buffer.from(content, 'utf8')
  try {
    if ((await readFile(target)).equals(expected)) return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, expected)
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
  return true
}

export async function installCli(): Promise<{ cliDir: string; changed: boolean; posixShimWarning: string }> {
  const cliDir = getCliDir()
  const executable = process.execPath
  const script = resolveCliScriptPath()
  const cmdShim = [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    'set "ELECTRON_RUN_AS_NODE=1"',
    `${quoteCmdPath(executable)} ${quoteCmdPath(script)} %*`,
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n')
  const posixShim = [
    '#!/bin/sh',
    'export ELECTRON_RUN_AS_NODE=1',
    `exec ${quoteShellPath(executable)} ${quoteShellPath(script)} "$@"`,
    '',
  ].join('\n')

  await mkdir(cliDir, { recursive: true })
  const changes = await Promise.all([
    writeIfChanged(join(cliDir, 'omaestri.cmd'), cmdShim),
    writeIfChanged(join(cliDir, 'omaestri'), posixShim),
  ])
  return {
    cliDir,
    changed: changes.some(Boolean),
    posixShimWarning: 'O shim POSIX foi gravado sem chmod e pode nao ser executavel no Git Bash.',
  }
}
