/**
 * Logger do processo principal.
 *
 * Sem dependencia externa. Escreve sempre em stderr (visivel no terminal de dev)
 * e, opcionalmente, em arquivo rotativo em `<root>/logs/app.log`.
 *
 * Nivel controlado por `OPEN_MAESTRI_LOG` = debug | info | warn | error.
 * Default: debug em dev, info em producao.
 */

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug(message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const MAX_LOG_BYTES = 5 * 1024 * 1024

function isDev(): boolean {
  return process.env.NODE_ENV !== 'production' && !process.env.OPEN_MAESTRI_PACKAGED
}

function resolveLevel(): LogLevel {
  const raw = process.env.OPEN_MAESTRI_LOG?.toLowerCase()
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw
  return isDev() ? 'debug' : 'info'
}

let currentLevel: LogLevel = resolveLevel()
let logFile: string | undefined
let fileChecked = false
const ring: string[] = []
const RING_SIZE = 200

/** Ativa o arquivo de log. Chamado uma vez no bootstrap, depois de resolver os paths. */
export function configureLogFile(root: string): void {
  logFile = join(root, 'logs', 'app.log')
  fileChecked = false
}

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

function timestamp(): string {
  const d = new Date()
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

function rotateIfNeeded(path: string): void {
  try {
    const stat = statSync(path)
    if (stat.size < MAX_LOG_BYTES) return
    renameSync(path, `${path}.1`)
  } catch {
    // arquivo nao existe ainda: nada a rotacionar
  }
}

function writeToFile(line: string): void {
  if (!logFile) return
  try {
    if (!fileChecked) {
      mkdirSync(join(logFile, '..'), { recursive: true })
      fileChecked = true
    }
    rotateIfNeeded(logFile)
    appendFileSync(logFile, `${line}\n`, 'utf8')
  } catch {
    // Log nunca pode derrubar o app.
    logFile = undefined
  }
}

function emit(level: LogLevel, scope: string, message: string): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return
  const line = `${timestamp()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`
  ring.push(line)
  if (ring.length > RING_SIZE) ring.shift()
  process.stderr.write(`${line}\n`)
  writeToFile(line)
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m) => emit('debug', scope, m),
    info: (m) => emit('info', scope, m),
    warn: (m) => emit('warn', scope, m),
    error: (m) => emit('error', scope, m),
  }
}

/** Ultimas linhas para o comando `omaestri debug`. */
export function recentLogs(count = 15): string[] {
  return ring.slice(-count)
}

export function describeError(e: unknown): string {
  if (e instanceof Error) return e.stack ?? `${e.name}: ${e.message}`
  return String(e)
}
