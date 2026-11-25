import { readFile } from 'node:fs/promises'

import { MAX_SCROLLBACK_LINES } from '@shared/constants'
import { createLogger, describeError } from '../logger'
import { atomicWriteFile } from '../persistence/atomic'

const log = createLogger('ScrollbackStore')
const pendingWrites = new Map<string, Promise<void>>()

export function save(path: string, lines: string[]): Promise<void> {
  const content = lines.slice(-MAX_SCROLLBACK_LINES).join('\n')
  const previous = pendingWrites.get(path) ?? Promise.resolve()
  const write = previous.catch(() => undefined).then(() => atomicWriteFile(path, content))
  pendingWrites.set(path, write)
  return write.finally(() => {
    if (pendingWrites.get(path) === write) pendingWrites.delete(path)
  })
}

export async function load(path: string): Promise<string[]> {
  await pendingWrites.get(path)?.catch(() => undefined)
  try {
    const content = await readFile(path, 'utf8')
    return content === '' ? [] : content.split('\n').slice(-MAX_SCROLLBACK_LINES)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn(`Falha ao ler scrollback: ${describeError(error)}`)
    }
    return []
  }
}
