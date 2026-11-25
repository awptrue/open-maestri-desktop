import type { ConnectionRegistry } from './connection-registry'

export function buildConnectionBanner(
  registry: ConnectionRegistry,
  terminalId: string,
  names: Map<string, string>,
): string {
  const lines: string[] = []
  const peers = registry.peersOf(terminalId).map((id) => names.get(id) ?? id)
  if (peers.length > 0) lines.push(`-- conectado a: ${peers.join(', ')}`)

  const notes = registry.linkedNotesOf(terminalId).map((id) => names.get(id) ?? registry.noteName(id) ?? id)
  if (notes.length > 0) lines.push(`-- notas vinculadas: ${notes.join(', ')}`)

  return lines.join('\n')
}

export function formatAskHint(): string {
  return 'para falar com um agente conectado use: omaestri ask "Nome" "prompt"'
}
