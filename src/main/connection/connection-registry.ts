import { nodeIdsByType, type WorkspacePayload } from '@shared/models/workspace'

type LinkIndex = Map<string, Set<string>>

function addLink(index: LinkIndex, terminalId: string, targetId: string): void {
  const targets = index.get(terminalId)
  if (targets) targets.add(targetId)
  else index.set(terminalId, new Set([targetId]))
}

export class ConnectionRegistry {
  private readonly peers = new Map<string, Set<string>>()
  private readonly notes = new Map<string, Set<string>>()
  private readonly noteNames = new Map<string, string | undefined>()

  constructor(payload?: WorkspacePayload) {
    if (payload) this.rebuild(payload)
  }

  rebuild(payload: WorkspacePayload): void {
    this.peers.clear()
    this.notes.clear()
    this.noteNames.clear()

    const terminals = nodeIdsByType(payload, 'terminal')
    for (const node of payload.nodes) {
      if (node.content.type === 'stickyNote') this.noteNames.set(node.id, node.content.value.fileName)
    }

    for (const { terminalIdA, terminalIdB } of payload.connections) {
      if (terminalIdA === terminalIdB || !terminals.has(terminalIdA) || !terminals.has(terminalIdB)) continue
      addLink(this.peers, terminalIdA, terminalIdB)
      addLink(this.peers, terminalIdB, terminalIdA)
    }

    for (const { terminalId, noteNodeId } of payload.noteConnections) {
      if (terminals.has(terminalId) && this.noteNames.has(noteNodeId)) addLink(this.notes, terminalId, noteNodeId)
    }
  }

  peersOf(terminalId: string): string[] {
    return [...(this.peers.get(terminalId) ?? [])].sort()
  }

  linkedNotesOf(terminalId: string): string[] {
    return [...(this.notes.get(terminalId) ?? [])]
  }

  isConnected(firstTerminalId: string, secondTerminalId: string): boolean {
    return this.peers.get(firstTerminalId)?.has(secondTerminalId) ?? false
  }

  noteName(noteNodeId: string): string | undefined {
    return this.noteNames.get(noteNodeId)
  }
}

export function terminalNames(payload: WorkspacePayload): Map<string, string> {
  const names = new Map<string, string>()
  for (const { content } of payload.nodes) {
    if (content.type === 'terminal') names.set(content.value.id, content.value.name)
  }
  return names
}
