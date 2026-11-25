# Architecture

## System Shape

```
Electron Main (Node)                          Renderer (React)
├── index.ts  bootstrap                       ├── App.tsx
├── window.ts                                 ├── canvas/    Viewport, ConnectionLayer, Toolbar
├── ipc-bridge.ts   <--- contextBridge --->   ├── nodes/     Terminal, Note, FileTree, Text
├── persistence/    atomic JSON I/O           └── store.ts   zustand
├── workspace/      node factory, migrations
├── terminal/       node-pty sessions
├── connection/     graph + skill injection
├── note/           markdown files
├── portal/         WebContentsView
├── filetree/       chokidar watcher
└── ipc-server/     HTTP + named pipe, CLI handlers
```

## Boot Sequence (ordem imutavel)

1. **CLI server** — pipe `\\.\pipe\omaestri-agent` e TCP `127.0.0.1:<dinamica>` sobem antes da UI,
   para que terminais restaurados ja consigam chamar `omaestri`.
2. **Skill install** — copia/injeta o script `omaestri` no PATH do usuario (idempotente).
3. **Persistence load** — `app-state.json`, `preferences.json`, `manifest.json` em paralelo.
4. **Crash recovery** — se `cleanShutdown === false`, marca `needsRecovery` e mantem a flag `false`.
5. **Window** — `BrowserWindow`, renderer carrega o workspace ativo.
6. **Terminal restore** — recria PTYs dos nos terminais e re-injeta skill nas conexoes existentes.

`cleanShutdown` vira `true` apenas no `before-quit`.

## Data Flow

```
Renderer (zustand)
   │  intencao: moveNode(patch) / addNode / connect / ...
   ▼
ipc-bridge (ipcMain.handle)
   │
   ▼
WorkspaceStore (main)  ── marca dirty ──► Autosave (30 s, dirty-gated)
   │                                          │
   │                                          ▼
   │                                   PersistenceManager (.tmp + rename)
   ▼
renderer-bound patch (ipcRenderer.on)  ◄── canonical state
```

Autoridade do estado fica no **main**. O renderer mantem copia para 60 fps de canvas; em
divergencia, o patch vindo do main vence.

## Autosave

- Intervalo: 30 s, apenas workspaces com `isDirty`.
- Antes do I/O: snapshot serializado na thread principal, escrita em seguida.
- Apos sucesso: `isDirty = false`; falha mantem a flag e registra em log.

## Terminal Pipeline

```
node-pty (ConPTY)  ── data ──►  @xterm/headless (main, scrollback + parser)
                                   │
                                   ├─► IPC "terminal:data" ──► xterm.js (renderer, visual)
                                   └─► ActivityMonitor (padroes de prompt/idle)
```

Duas instancias de emulador: a headless no main serve para scrollback persistente e para o
`ActivityMonitor` detectar quando o agente terminou de responder; a do renderer so desenha.

`list`/`ask` precisam do parser no main porque o CLI pode ser chamado com o node fora do viewport.

## Connection Model (persistido)

| Tipo | Struct | Campos-chave |
|------|--------|--------------|
| Terminal ↔ Terminal | `TerminalConnection` | `terminalIdA`, `terminalIdB`, `ropePoints` |
| Terminal → Nota | `NoteConnection` | `terminalId`, `noteNodeId` |
| Terminal → Portal | `PortalConnection` | `terminalId`, `portalNodeId` |
| Nota ↔ Nota | `NoteToNoteConnection` | `noteNodeIdA`, `noteNodeIdB` |
| Portal ↔ Portal | `PortalToPortalConnection` | `portalIdA`, `portalIdB` |
| Cross-floor | `CrossFloorConnection` | `nodeIdA/B`, `floorIdA/B`, `ropePoints` |

`ropePoints` e `[[x, y], ...]` com 21 pontos de controle (corda de 20 segmentos).

## Canvas Rendering

- `transform: translate(ox, oy) scale(z)` no container; nos posicionados em coordenadas de mundo.
- Culling: so renderiza nos cujos frames intersectam o viewport com 200 px de margem.
- Z-index: lista pre-ordenada ascendente (render) e descendente (hit test).
- Drag/resize: atualizacao direta do frame durante o gesto; commit no main no fim.
- Conexoes: um unico SVG overlay em coordenadas de mundo, atras dos nos.

## Concurrency

- Main process e single-threaded, mas todo I/O e `await` — nunca bloqueia o loop.
- Escrita atomica serializada por workspace (fila por `workspaceId`).
- PTY data chega por callback; repasse ao renderer com throttle por frame (16 ms) para nao saturar IPC.

## On-Disk Layout

```
%USERPROFILE%\.open-maestri\
├── manifest.json
├── preferences.json
├── app-state.json
├── run\
│   └── agent.pipe
└── workspaces\{UUID}\
    ├── workspace.json
    ├── notes\{name}.md
    └── terminals\{UUID}.scrollback
```
