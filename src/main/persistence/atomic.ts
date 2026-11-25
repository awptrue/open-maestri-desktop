/**
 * Escrita atomica de JSON no padrao do `PersistenceManager.swift`:
 * grava `<arquivo>.tmp`, faz flush e so entao troca o arquivo final.
 *
 * Nunca truncamos um arquivo existente: se o processo cair no meio, o
 * `workspace.json` anterior continua intacto.
 */

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

let sequence = 0

/**
 * Grava `data` de forma atomica em `target`.
 *
 * No Windows, `fs.rename` substitui o destino apenas quando ele nao esta aberto
 * por outro processo. Como so o app escreve esses arquivos, o rename e suficiente
 * e mais rapido que copiar para um temp global.
 */
export async function atomicWriteFile(target: string, data: string): Promise<void> {
  const dir = dirname(target)
  await fs.mkdir(dir, { recursive: true })

  sequence = (sequence + 1) % 1_000_000
  const tmp = join(dir, `.${Date.now()}-${sequence}.tmp`)

  const handle = await fs.open(tmp, 'w')
  try {
    await handle.writeFile(data, 'utf8')
    // flush explicito: sem isso o rename pode publicar um arquivo vazio
    // se o SO tiver o buffer em cache e a maquina reiniciar.
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    await fs.rename(tmp, target)
  } catch (err) {
    await fs.rm(tmp, { force: true })
    throw err
  }
}

export async function readJsonFile(path: string): Promise<unknown | undefined> {
  try {
    const raw = await fs.readFile(path, 'utf8')
    if (raw.trim() === '') return undefined
    return JSON.parse(raw) as unknown
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return undefined
    throw err
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Serializa JSON compativel com o encoder do Swift.
 *
 * O Swift em DEBUG usa `.prettyPrinted, .sortedKeys`; usamos a mesma forma para
 * que diffs entre macOS e Windows fiquem legiveis e comparaveis.
 *
 * `JSON.stringify` com indentacao preserva a ordem de insercao, entao a
 * ordenacao das chaves e feita explicitamente aqui.
 */
export function stringifyCompressed(value: unknown): string {
  return JSON.stringify(value)
}

export function stringifyPretty(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value), null, 2)
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}
