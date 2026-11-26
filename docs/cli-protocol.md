# Protocolo do CLI `omaestri`

Este documento descreve o CLI da v1 para Windows. As diferenças em relação ao
macOS são indicadas junto aos comandos.

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

No Windows, lista as sessões de terminal do workspace, incluindo nome, tipo,
estado, ID, diretório e conexões. A seção `Notas:` mostra os nomes literais dos
arquivos, incluindo `.md`, e sinaliza notas sem conexão. Sem sessões, retorna
`Nenhum terminal conectado neste workspace.`.

No macOS, o formato é diferente (`ListHandler.swift:17-67`):

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

No Windows, envia o prompt com `\r` ao PTY de um agente conectado ao terminal
chamador. Aguarda o terminal ficar ocioso (2 s sem saída) por até 30 s e retorna
até 200 linhas da saída atual. Em timeout, devolve a saída disponível com aviso.
Ociosidade não garante que o agente terminou. Quando o alvo não está conectado,
o roteador responde com `error:` e orienta a consultar `list`.

No macOS, retorna o snapshot integral; a detecção de término depende do tipo de
agente (`AskHandler.swift:116-183`).

**Regra para o agente:** nunca reenviar o prompt após timeout. Usar `check`.

### `check "Agente" [linhas]`

No Windows, retorna as últimas N linhas do terminal conectado, com padrão de 60.
Sem saída, retorna `(sem saida)`. No macOS, o padrão é 20 e o retorno vazio é
`(no recent output)`.

### `context`

Mostra os terminais e as notas vinculados ao terminal chamador, mais a dica de
uso de `ask`. Execute dentro de um terminal do canvas.

### `note read "Nome"`

No Windows, lê o conteúdo integral, sem números de linha. Nota sem conteúdo
retorna `(nota vazia)`. Nos comandos `read`, `write` e `edit`, use o nome literal
do `list` (por exemplo, `Nota 1.md`) ou o nome curto (`Nota 1`). A busca ignora
maiúsculas e minúsculas e prioriza o nome literal, primeiro com caixa idêntica.

Somente no macOS: `note read "Nome" [offset] [limit]` para leitura paginada e
numerada (`NoteFileManager.swift:29-50`).

### `note write "Nome" "conteúdo"`

Substitui o conteúdo inteiro. A resposta de sucesso começa com `ok:` no Windows
e é `OK` no macOS.

### `note edit "Nome" "antigo" "novo"`

Substitui a primeira ocorrência. A resposta no Windows começa com `ok:` se a
alteração for gravada, ou `error:` se o trecho não existir.

### `note create ["conteúdo"]` (somente macOS)

No macOS, devolve o nome atribuído (`Note-<8 hex>`). No Windows, crie a nota no
canvas antes de usar os comandos de nota.

### `notify "mensagem"`

Notificação de sistema. Não aparece na lista de comandos do Swift original
(comando adicional do port Windows).

### `role` / `preset` / `recruit` / `dismiss` / `connect`

Esses comandos fazem parte do Maestro Mode no macOS e não estão implementados na
v1 para Windows. No macOS, `recruit` e `dismiss` exigem que o chamador seja
`isManager` (fail-closed).

### `debug`

`open-maestri inter-agent server debug:` + porta, terminal ID, comandos.
O port Windows acrescenta estado do terminal, workspace e últimas linhas de log.

## Entrega de resposta ao agente

No Windows, o cabeçalho de `ask` identifica o alvo e nomeia o timeout quando
ocorre. As últimas 200 linhas do buffer podem incluir o eco do prompt e saída
anterior; não há arquivo separado nem recorte que isole só a resposta nova.

Implicação de projeto: o buffer autoritativo vive no main (`@xterm/headless`), não no
renderer. O CLI pode ser chamado com o nó fora do viewport.

## Instalação no PATH (Windows)

Dois shims em `%USERPROFILE%\.open-maestri\bin`:

- `omaestri.cmd` (CRLF) — para `cmd.exe` e PowerShell
- `omaestri` (LF) — para Git Bash

Ambos executam o Node embutido do Electron via `ELECTRON_RUN_AS_NODE=1`, sem runtime extra.
O diretório é colocado no início do `PATH` de cada PTY (`cli-install.ts:24-98`).

## Skill injection

No Windows, o app instala `open-maestri/SKILL.md` em cada raiz de skills ativa.
Não regrava um arquivo idêntico à versão distribuída, mas substitui o conteúdo
quando ele difere da versão distribuída, inclusive edições locais nesse arquivo.
