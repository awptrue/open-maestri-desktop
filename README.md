# open-maestri-desktop

Canvas espacial de orquestracao de agentes de IA para **Windows 10/11 (x64)**.
Reescrita em Electron + TypeScript do [open-maestri](https://github.com/pedrotecinf/open-maestri) (Swift/AppKit, macOS).

Terminais reais de Claude Code, Codex, OpenCode, Gemini CLI e shell num canvas infinito,
conectados entre si: um agente fala com outro pelo CLI `omaestri`, sem intermediario humano.

## Estado do projeto

| Etapa | Estado |
|-------|--------|
| Estrutura do workspace e convencoes | concluido |
| Modelo de dados compativel com `workspace.json` (schemaVersion 2) | em andamento |
| PTY (ConPTY via `@lydell/node-pty`) | validado no Windows 10 |
| Canvas com pan/zoom | pendente |
| Renderer (React + xterm) | pendente |
| CLI `omaestri` | pendente |

## Requisitos

- Windows 10 build 1809+ ou Windows 11, x64
- Node.js 22.12+
- Nenhuma ferramenta de build C++ necessaria: o PTY usa prebuild ConPTY

## Desenvolvimento

```powershell
npm install
npm run dev          # Electron com hot reload
npm run typecheck    # tsc nos dois projetos (node + web)
npm test             # vitest
npm run build        # typecheck + bundle de producao
npm run package      # instalador NSIS + portable em dist/
```

## Compatibilidade com o macOS

O app le e grava exatamente o mesmo diretorio de dados:

```
%USERPROFILE%\.open-maestri\
├── manifest.json               # indice de workspaces (schemaVersion 1)
├── preferences.json
├── app-state.json              # activeWorkspaceId + cleanShutdown
├── run\
│   └── agent.pipe              # named pipe global do CLI
└── workspaces\{UUID}\
    ├── workspace.json          # schemaVersion 2 — nos + conexoes
    ├── notes\{name}.md
    └── terminals\{UUID}.scrollback
```

Um workspace criado no macOS abre no Windows e vice-versa.
Detalhes do contrato em [docs/compatibility.md](docs/compatibility.md).

### Divergencias inevitaveis

| Item | macOS | Windows |
|------|-------|---------|
| Transporte do CLI | Unix socket + TCP | Named pipe `\\.\pipe\omaestri-agent` + TCP `127.0.0.1` |
| Caminho no JSON | POSIX (`/Users/...`) | Normalizado para POSIX na escrita, convertido na leitura |
| Shell | `zsh`/`bash` | PowerShell, `cmd`, Git Bash (`shell-resolver.ts`) |
| Portal | WKWebView | `WebContentsView` do Electron |
| Ombro | Apple Foundation Models | nao existe equivalente — fora de escopo |

## Documentacao

- [AGENTS.md](AGENTS.md) — contrato de trabalho para agentes de codigo
- [docs/architecture.md](docs/architecture.md) — arquitetura, fluxo de dados, modulos
- [docs/compatibility.md](docs/compatibility.md) — contrato exato do formato em disco
- [docs/cli-protocol.md](docs/cli-protocol.md) — protocolo do CLI `omaestri`

## Licenca

GPL-3.0-or-later. Ver [LICENSE](LICENSE) e [NOTICE](NOTICE).
