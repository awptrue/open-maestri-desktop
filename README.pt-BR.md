# open-maestri-desktop

[English](README.md)

Canvas espacial para orquestrar agentes de IA. A versão 1 tem como alvo o **Windows 10 (x64)**.
Feito com Electron e TypeScript, o projeto reimplementa o open-maestri, originalmente desenvolvido para macOS com Swift e AppKit.

Use Claude Code, Codex, OpenCode, Gemini CLI ou um shell em terminais reais num canvas infinito.
Conecte os terminais para que os agentes conversem diretamente pela CLI `omaestri`.

## Estado do Projeto

A versão 1 está em desenvolvimento. A validação para lançamento tem foco no Windows 10 (x64).

| Etapa | Estado |
| --- | --- |
| Canvas, terminais com PTY, notas em Markdown, árvore de arquivos, persistência do workspace e CLI `omaestri` | Implementados |
| Versão portátil no Windows 10 | Build `7a93d44` passou nos testes básicos: ajuda da CLI, ConPTY, acesso a notas pelo nome completo do arquivo e pelo nome curto, e reabertura normal do workspace |
| `omaestri ask` e `omaestri check` no Windows 10 | No portátil `7a93d44`, os dois comandos passaram de ponta a ponta via shim da CLI entre dois terminais PowerShell conectados, usando ConPTY. Ambos rejeitaram um terminal sem conexão. O teste com agente de IA autenticado não foi executado por falta de um perfil de QA autenticado. |
| Instalador NSIS no Windows 10 | A build `7a93d44` passou na instalação silenciosa por usuário, no teste básico do app instalado e na desinstalação. O assistente gráfico ainda não foi testado com uma conta de usuário padrão. |
| Exibição e notificações no Windows 10 | Layout aprovado na janela mínima (900 x 600 DIP, escala de tela de 100%). Faltam testar a janela maximizada e a escala nativa de 125%. A CLI aceitou o pedido de notificação, mas a exibição no Windows não foi confirmada. |
| Windows 11 | Adiado para depois da v1; não validado |

## Requisitos

- Windows 10 (x64)
- Node.js 22.12 ou superior
- Não precisa de ferramentas de compilação C++: o PTY usa binários ConPTY pré-compilados.

## Desenvolvimento

```powershell
npm install
npm run dev          # Electron com recarregamento automático
npm run typecheck    # Verifica os tipos dos projetos Node.js e renderer
npm test             # Executa o Vitest
npm run build        # Verifica os tipos e gera a versão de produção
npm run package      # Gera o instalador NSIS e o executável portátil em dist/
```

## Compatibilidade com o macOS

O app para Windows usa a mesma estrutura de dados de workspace do app para macOS:

```
%USERPROFILE%\.open-maestri\
├── manifest.json               # índice de workspaces (schemaVersion 1)
├── preferences.json
├── app-state.json              # activeWorkspaceId + cleanShutdown
└── workspaces\{UUID}\
    ├── workspace.json          # schemaVersion 2: nós e conexões
    ├── notes\{name}.md
    └── terminals\{UUID}.scrollback
```

Veja o [guia de compatibilidade](docs/compatibility.md) para detalhes de formato e migração.

### Diferenças entre Plataformas

| Item | macOS | Windows |
|------|-------|---------|
| Transporte da CLI | Socket Unix + TCP | Named pipe `\\.\pipe\omaestri-agent` + TCP em loopback |
| Caminhos no JSON | POSIX (`/Users/...`) | Gravados em formato POSIX e convertidos na leitura |
| Shell | `zsh`/`bash` | PowerShell, `cmd`, Git Bash (`shell-resolver.ts`) |
| Portal | WKWebView | `WebContentsView` do Electron |
| Ombro | Apple Foundation Models | Sem equivalente; fora do escopo |

## Documentação

- [Arquitetura](docs/architecture.md): estrutura, fluxo de dados e módulos
- [Compatibilidade](docs/compatibility.md): formato dos dados em disco
- [Protocolo da CLI](docs/cli-protocol.md): protocolo de comandos da `omaestri`

## Licença

GPL-3.0-or-later. Veja [LICENSE](LICENSE) e [NOTICE](NOTICE).
