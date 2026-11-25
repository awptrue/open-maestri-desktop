# Protocolo do CLI `omaestri`

Contrato verificado contra `_ref/pedro/Sources/` (Swift, fonte da verdade) e
`_ref/igor/cli/omaestri.js` (port Windows).

## Transporte

```
POST /cli HTTP/1.0
Host: maestri
X-Terminal-ID: <UUID MAIUSCULO>
Content-Type: application/json
Content-Length: <n>

{"args":["ask","NomeDoAgente","prompt"]}
```

Resposta: `HTTP/1.0 200 OK`, `Content-Type: text/plain; charset=utf-8`,
`Content-Length`, `Connection: close`.

**Nunca há 4xx/5xx por erro de comando.** Erro é corpo de texto começando com `error: `.
O CLI imprime o corpo em stdout e sai com código 0 nesse caso. Status `>= 300` (só o 404/413
do port Windows) vira stderr e `exit 1`.

Referências: `InterAgentServer.swift:304-354`, `Transport.swift:50-102`, `omaestri.js:58-131`.

## Transportes

| Canal | macOS | Windows |
|-------|-------|---------|
| Principal | Unix socket `~/.open-maestri/run/agent.sock` | named pipe `\\.\pipe\omaestri-agent` |
| Secundário | TCP `127.0.0.1:<porta dinâmica>` | TCP `127.0.0.1:<porta dinâmica>` |

Descoberta **não** usa arquivo de porta: o PTY recebe variáveis de ambiente.

| Variável | Conteúdo |
|----------|----------|
| `MAESTRI_TERMINAL_ID` | UUID do terminal (vai no header `X-Terminal-ID`) |
| `OMAESTRI_TERMINAL_ID` | alias aceito |
| `MAESTRI_SOCKET` / `MAESTRI_PIPE` | caminho do socket / nome do pipe |
| `MAESTRI_SERVER_PORT` | porta TCP de fallback |
| `MAESTRI_CLI` | caminho absoluto do executável `omaestri` |

`X-Terminal-ID` é a única identidade; não há autenticação. Qualquer processo local pode
enviar qualquer UUID — é um limite do modelo, herdado do macOS.

## Comandos

### `list`

```
You:
  - name: "<nome do chamador>"

Connected agents:
  - name: "<agente>"

Connected portals (use `omaestri portal snapshot`):
  - name: "<portal>" - url: <url>

Connected notes (use `omaestri note read/write/edit`):
  - name: "<nota>"
```

Seções separadas por linha em branco. Sem conexões: `You:` + `\n\nNo connections.`
(`ListHandler.swift:17-67`).

### `ask "Agente" "prompt"` — síncrono

Injeta o prompt no PTY do alvo (terminando em `\r`, nunca `\n`) e espera a resposta
terminar. Timeout servidor de **30 s**. Retorna o snapshot do buffer inteiro, ANSI removido.

Estratégia de término (`AskHandler.swift:116-183`):

| Tipo de agente | Sinal de término |
|----------------|------------------|
| `generic_shell` | prompt retornou (regex de prompt Windows + POSIX) |
| todos os outros | 2 s sem saída (`agentIdleTimeout`) |

Em timeout: devolve o parcial. Alvo inexistente:
`error: agent 'X' not found. Use 'omaestri list' to see connected agents.`

**Regra para o agente:** nunca reenviar o prompt após timeout. Usar `check`.

### `check "Agente" [linhas]`

Últimas N linhas (default 20) do buffer do terminal alvo. Vazio: `(no recent output)`.

### `note read "Nome" [offset] [limit]`

```
[14 lines total]
1       conteúdo
```

Com offset: `[lines 10-14 of 14]` + linhas numeradas (`NoteFileManager.swift:29-50`).

### `note write "Nome" "conteúdo"`

Substitui tudo. Resposta: `OK`. Escrita atômica no macOS.

### `note edit "Nome" "antigo" "novo"`

Substitui a primeira ocorrência. `OK` ou `error: Text 'antigo' not found in note`.

### `note create ["conteúdo"]`

Nome gerado `Note-<8 hex>`. Resposta: o nome atribuído.

### `notify "mensagem"`

Notificação de sistema. Não aparece na lista de comandos do Swift original
(comando adicional do port Windows).

### `role` / `preset` / `recruit` / `dismiss` / `connect`

Maestro Mode. `recruit`/`dismiss` exigem que o chamador seja `isManager`
(fail-closed). Fora do escopo da v1 — ver `AGENTS.md`.

### `debug`

`open-maestri inter-agent server debug:` + porta, terminal ID, comandos.
O port Windows acrescenta estado do terminal, workspace e últimas linhas de log.

## Entrega de resposta ao agente

Não há marcador nem arquivo. O `ask` devolve o **snapshot integral** do buffer: o agente
chamador lê o texto e interpreta. Isso significa que o chamador recebe também o eco do
próprio prompt e o histórico visível.

Implicação de projeto: o buffer autoritativo vive no main (`@xterm/headless`), não no
renderer. O CLI pode ser chamado com o nó fora do viewport.

## Instalação no PATH (Windows)

Dois shims em `%USERPROFILE%\.open-maestri\bin`:

- `omaestri.cmd` (CRLF) — para `cmd.exe` e PowerShell
- `omaestri` (LF) — para Git Bash

Ambos executam o Node embutido do Electron via `ELECTRON_RUN_AS_NODE=1`, sem runtime extra.
O diretório é colocado no início do `PATH` de cada PTY (`cli-install.ts:24-98`).

## Skill injection

O app escreve `SKILL.md` em cada raiz de skill ativa (default: `~/.claude/skills`).
Idempotente: se o arquivo existe, **não sobrescreve** — edição do usuário é preservada
(`SkillInjector.swift:19-51`).
