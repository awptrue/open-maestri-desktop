/**
 * Primitivas de codificacao que replicam o comportamento do `JSONEncoder` /
 * `JSONDecoder` do Swift usado pelo open-maestri original.
 *
 * Cada funcao aqui existe por causa de uma incompatibilidade concreta entre
 * Swift e JavaScript. Nao sao helpers de conveniencia.
 */

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

/**
 * O Swift usa `.iso8601`, que corresponde a `ISO8601DateFormatter` com
 * `.withInternetDateTime` — e esse formatter **rejeita fracoes de segundo**.
 *
 * `Date.prototype.toISOString()` em JS sempre emite `.000Z`, o que faria o
 * open-maestri no macOS falhar ao ler nossos arquivos. Sempre serializar sem
 * milissegundos.
 */
export function encodeDate(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function decodeDate(s: unknown): Date {
  if (typeof s !== 'string') throw new TypeError(`data deve ser string ISO8601, recebido: ${typeof s}`)
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) throw new Error(`data ISO8601 invalida: ${s}`)
  return d
}

/** Decodifica data opcional, retornando `undefined` quando ausente ou invalida. */
export function decodeDateOptional(s: unknown): Date | undefined {
  if (s === undefined || s === null) return undefined
  try {
    return decodeDate(s)
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// UUIDs
// ---------------------------------------------------------------------------

/**
 * `UUID.uuidString` do Swift e **maiusculo**; `crypto.randomUUID()` do Node e
 * minusculo. Normalizamos tudo para maiusculo — assim o que gravamos e byte a
 * byte igual ao que o Maestri gravaria, e chaves de Map ficam consistentes.
 */
export function newId(): string {
  return randomUuid().toUpperCase()
}

function randomUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  throw new Error('crypto.randomUUID indisponivel neste runtime')
}

export function normalizeId(id: string): string {
  return id.toUpperCase()
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function requireUuid(value: unknown, field: string): string {
  if (!isUuid(value)) throw new Error(`UUID invalido em "${field}": ${String(value)}`)
  return normalizeId(value)
}

/**
 * UUID opcional: `undefined`/`null` viram `undefined` (o campo e omitido na
 * escrita, nunca vira `null`).
 */
export function optionalUuid(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requireUuid(value, field)
}

// ---------------------------------------------------------------------------
// Omissao de opcionais
// ---------------------------------------------------------------------------

/**
 * O encoder sintetizado do Swift usa `encodeIfPresent` para `Optional`, ou seja,
 * a chave e **omitida** quando nula — nunca escrita como `null`.
 * `JSON.stringify` ja omite `undefined`, entao basta garantir que nunca
 * produzimos `null` em campos opcionais.
 */
export function omitNullish<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k] = v
  }
  return out as T
}

// ---------------------------------------------------------------------------
// Leitura defensiva
// ---------------------------------------------------------------------------

export function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`esperado objeto em "${field}"`)
  }
  return value as Record<string, unknown>
}

export function readString(obj: Record<string, unknown>, key: string, fallback?: string): string {
  const v = obj[key]
  if (typeof v === 'string') return v
  if (fallback !== undefined) return fallback
  throw new Error(`campo string obrigatorio ausente: "${key}"`)
}

export function readNumber(obj: Record<string, unknown>, key: string, fallback?: number): number {
  const v = obj[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  if (fallback !== undefined) return fallback
  throw new Error(`campo numerico obrigatorio ausente: "${key}"`)
}

export function readBool(obj: Record<string, unknown>, key: string, fallback?: boolean): boolean {
  const v = obj[key]
  if (typeof v === 'boolean') return v
  if (fallback !== undefined) return fallback
  throw new Error(`campo booleano obrigatorio ausente: "${key}"`)
}

export function readOptionalNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key]
  if (v === undefined || v === null) return undefined
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return undefined
}

export function readOptionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key]
  return typeof v === 'string' ? v : undefined
}

export function readArray(obj: Record<string, unknown>, key: string): unknown[] {
  const v = obj[key]
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw new Error(`campo "${key}" deveria ser array`)
  return v
}
