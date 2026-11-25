import { statSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'

const shellLabels = ['pwsh', 'powershell', 'cmd'] as const

export function findOnPath(exe: string): string | undefined {
  if (!/^[^\\/:]+\.exe$/i.test(exe)) return undefined

  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    const directory = entry.trim().replace(/^"(.*)"$/, '$1')
    if (!directory) continue

    const candidate = resolve(directory, exe)
    try {
      if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate
    } catch {
      continue
    }
  }
  return undefined
}

export function resolveShell(): { file: string; args: string[]; label: (typeof shellLabels)[number] } {
  if (process.platform !== 'win32') throw new Error('sha-resolver: plataforma nao suportada')

  for (const label of shellLabels) {
    const file = findOnPath(`${label}.exe`)
    if (file) return { file, args: label === 'cmd' ? [] : ['-NoLogo'], label }
  }

  throw new Error('shell-resolver: pwsh.exe, powershell.exe e cmd.exe nao encontrados no PATH')
}
