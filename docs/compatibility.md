# Compatibilidade com o open-maestri (macOS)

Contrato exato de leitura/escrita. Fonte da verdade: `_ref/pedro/Sources/` (Swift).
Toda afirmação abaixo foi verificada no código-fonte, com caminho e linha.

## Regras de codificação (inegociáveis)

| Regra | Motivo | Referência |
|-------|--------|-----------|
| Data ISO8601 **sem** fração de segundo | `ISO8601DateFormatter` com `.withInternetDateTime` rejeita `.000` | `PersistenceManager.swift:39-46` |
| UUID em **MAIÚSCULO** | `UUID.uuidString` do Swift é maiúsculo | `UUID+Coding.swift` |
| Opcionais **omitidos**, nunca `null` | encoder sintetizado usa `encodeIfPresent` | `codec.ts:omitNullish` |
| `frame` = `[[x, y], [w, h]]` | `CGRect+Frame.swift` | `CanvasNode.swift:39-59` |
| `NodeContent` com envelope `{"<tipo>": {"_0": {...}}}` | `NodeContent.swift:60-88` | testado em `CGRectFrameTests.swift:114-140` |
| Escrita atômica (`.tmp` + replace) | `PersistenceManager.atomicWrite` | `PersistenceManager.swift:124-145` |
| `schemaVersion: 2` no workspace | `Constants.schemaVersion` | `Constants.swift:7` |

## Estrutura de `workspace.json`

```json
{
  "schemaVersion": 2,
  "type": "workspace",
  "payload": { "...": "WorkspacePayload" }
}
```

O envelope `{schemaVersion, type, payload}` é obrigatório (`WorkspaceDocument.swift:5-15`).
Payload completo em `WorkspacePayload.swift:5-60`:

```ts
{
  id, name, icon, isPinned,
  locationType: 'local' | 'ssh',
  workingDirectory, preferredIDE: 'cursor' | 'vscode' | 'xcode', syncConfigFiles,
  canvasOrigin: { x: 9800, y: 8500 },
  canvasZoom: number,
  nodes: CanvasNode[],
  connections: TerminalConnection[],          // terminal ↔ terminal
  noteConnections: NoteConnection[],          // terminal ↔ nota
  portalConnections: PortalConnection[],      // terminal ↔ portal
  portalToPortalConnections: PortalToPortalConnection[],
  noteToNoteConnections: NoteToNoteConnection[],
  crossFloorConnections: CrossFloorConnection[],
  floors: FloorEntry[],
  drawings: Drawing[],
  createdAt, lastOpenedAt?, lastModifiedAt
}
```

## Os 8 tipos de `NodeContent`

Todos serializam como `{ "<tipo>": { "_0": {...} } }` (`NodeContent.swift:5-13`).

| Tipo | Campos | Defaults |
|------|--------|----------|
| `terminal` | `agentType`, `command`, `name`, `icon`, `color`, `id`, `shellPath`, `workingDirectory`, `status`, `isManager`, `monitorWithOmbro`, `autoScrollLocked`, `shortcutMode:{kind}`, `scrollbackLineCount` + opcionais `assignedRoleId`, `scrollbackFile`, `lastActiveAt`, `themeId`, `fontFamily`, `fontSize` | `icon:"terminal"`, `color:"#007AFF"`, `status:"idle"`, `shortcutMode.kind:"automatic"` |
| `stickyNote` | `color`, `fileName?`, `fontSize`, `hasCustomName`, `isPreviewing`, `storageMode` | `color:"#FEFDE8"`, `fontSize:14` |
| `portal` | `id`, `name`, `currentURL`, `source`, `status`, `chromeHidden`, `storageScope` | `status:"idle"`, `storageScope:"isolated"` |
| `fileTree` | `name`, `rootPath`, `viewMode` | `viewMode:"list"` |
| `text` | `text`, `fontSize`, `fontWeight`, `color`, `alignment`, `fontFamily` | `fontSize:18`, `color:"#1a1a1a"`, `alignment:"left"`, `fontFamily:"sans"` |
| `shape` | `shapeType`, `fillColor`, `strokeColor`, `strokeWidth`, `strokeStyle`, `fillStyle`, `text`, `fontSize`, `rotation` | `rect`, `solid`, `solid`, `2.0`, `16`, `0` |
| `stroke` | `strokeType`, `startPoint`, `endPoint`, `controlPoint?`, `strokeColor`, `strokeWidth`, `strokeStyle` | pontos normalizados 0–1 |
| `freehand` | `freehandType`, `points`, `strokeColor`, `strokeWidth`, `opacity`, `rotation` | pen: 3px/1.0; highlighter: 12px/0.4 |

### Enums aninhados com payload

```json
"storageMode": {"managed": {}}
"storageMode": {"custom": {"_0": "/caminho/nota.md"}}
"source": {}                              // none
"source": {"url": {"_0": "https://..."}}
```

`StorageMode` em `NodeContent.swift:211-240`; `PortalSource` em `NodeContent.swift:264-291`.
Default de `storageMode` ausente é `managed`; de `source` ausente é `none`.

## `agentType` aceitos

`claude_code`, `codex`, `gemini_cli`, `open_code`, `generic_shell` (`NodeContent.swift:107`).

## `shortcutMode.kind`

`automatic`, `none`, `cmd1` … `cmd9` (`NodeContent.swift:152-189`).

## `frame` e `ropePoints`

- `frame`: `[[x, y], [w, h]]` — exatamente 2 arrays de 2 números, senão o Swift falha o decode.
- `ropePoints`: 21 pontos de controle `[[x, y], ...]` (`Constants.swift:20`).
- `drawings[].points` e `freehand.points`: `[[x, y], ...]`.
- `stroke.startPoint/endPoint/controlPoint`: normalizados 0–1 dentro do frame do nó.

## Diretório de dados

```
~/.open-maestri/                     (macOS)
%USERPROFILE%\.open-maestri/         (Windows — mesmo conteúdo)
├── manifest.json                    schemaVersion 1, type "appState"
├── preferences.json                 schemaVersion 1
├── app-state.json                   schemaVersion 1, type "appState", cleanShutdown
├── routines.json
├── sidebar-layout.json
├── run/agent.sock                   Unix socket (macOS)
├── roles/{roleId}/{CLAUDE.md,AGENTS.md,role.json}
└── workspaces/{UUID}/
    ├── workspace.json               schemaVersion 2
    ├── notes/{name}.md
    ├── terminals/{UUID}.scrollback
    └── snapshots/
```

Windows troca `run/agent.sock` por `\\.\pipe\omaestri-agent` — único desvio estrutural.

## Migração v1 → v2

`Migration_v1_to_v2.swift`. Se `schemaVersion < 2`, o payload é lido da raiz do objeto
(sem envelope `payload`) e normalizado em memória. Nós sem `zIndex`/`isLocked`/`lastModifiedAt`
recebem `0`/`false`/agora (`CanvasNode.swift:49-53`).

Implementado em `src/shared/models/workspace.ts:migrateWorkspacePayload`.

## Regras de robustez ao ler

1. Nó com `frame` inválido é **descartado**, não derruba o workspace.
2. Nó com tipo de conteúdo desconhecido é **descartado** (workspace do futuro).
3. Conexão órfã (nó inexistente) é **descartada** ao reconciliar.
4. Campo desconhecido é ignorado, nunca erro.
5. `noteConnections`/`portalConnections` ausentes viram `[]`.

## Como validar a compatibilidade

```powershell
npm test -- workspace-codec
```

Os testes usam fixtures copiadas do repo oficial (`tests/fixtures/macos-workspaces.ts`) e
verificam: leitura, escrita, ausência de `null`, formato de data, envelope `_0`, e
estabilidade de round-trip.

**Checklist ao adicionar campo novo:**

- [ ] tem default na leitura?
- [ ] é omitido quando ausente na escrita?
- [ ] round-trip coberto por teste?
- [ ] o macOS continua lendo? (fixture do oficial passa)
