#!/usr/bin/env node
'use strict'

const USAGE = `omaestri - comunicacao entre agentes no open-maestri

  omaestri list
  omaestri context
  omaestri ask "Nome" "prompt"
  omaestri check "Nome" [linhas]
  omaestri note read "Nome"
  omaestri note write "Nome" "conteudo"
  omaestri note edit "Nome" "antigo" "novo"
  omaestri notify "mensagem"
  omaestri debug
  omaestri help
`

const pipePrefix = '\\\\.\\pipe\\'
const pipeName = process.env.MAESTRI_PIPE || 'omaestri-agent'
const pipePath = pipeName.startsWith(pipePrefix) ? pipeName : pipePrefix + pipeName
const terminalId = process.env.MAESTRI_TERMINAL_ID || process.env.OMAESTRI_TERMINAL_ID || ''
const tcpPort = Number(process.env.MAESTRI_SERVER_PORT)
const hasTcpPort = Number.isInteger(tcpPort) && tcpPort > 0 && tcpPort <= 65535

function buildRequest(args) {
  const body = Buffer.from(JSON.stringify({ args }), 'utf8')
  const headers = [
    'POST /cli HTTP/1.0',
    'Host: maestri',
    `X-Terminal-ID: ${terminalId.toUpperCase()}`,
    'Content-Type: application/json',
    `Content-Length: ${body.length}`,
    '',
    '',
  ].join('\r\n')
  return Buffer.concat([Buffer.from(headers, 'utf8'), body])
}

async function exchange(address, request, onConnect) {
  const { createConnection } = await import('node:net')
  return new Promise((resolve, reject) => {
    const chunks = []
    let settled = false
    const finish = (fn) => (value) => {
      if (settled) return
      settled = true
      fn(value)
    }
    const ok = finish(resolve)
    const fail = finish(reject)

    const socket = createConnection(address, () => {
      onConnect?.()
      socket.write(request)
    })
    socket.on('data', (chunk) => chunks.push(chunk))
    socket.once('error', fail)
    socket.once('end', () => ok(Buffer.concat(chunks)))
    // `close` sempre vem depois de `end`. Sem a guarda, o socket fechado
    // rejeitaria uma resposta que ja tinha sido resolvida com sucesso.
    socket.once('close', () => fail(new Error('Conexao encerrada sem resposta completa.')))
  })
}

async function send(request) {
  let pipeConnected = false
  try {
    return await exchange({ path: pipePath }, request, () => { pipeConnected = true })
  } catch (pipeError) {
    if (pipeConnected || !hasTcpPort) throw pipeError
    try {
      return await exchange({ host: '127.0.0.1', port: tcpPort }, request)
    } catch (tcpError) {
      throw new Error(`pipe: ${pipeError.message}; TCP: ${tcpError.message}`)
    }
  }
}

function parseResponse(raw) {
  const headerEnd = raw.indexOf('\r\n\r\n')
  const statusEnd = raw.indexOf('\r\n')
  const statusLine = statusEnd < 0 ? '' : raw.toString('ascii', 0, statusEnd)
  const status = /^HTTP\/1\.[01] ([1-5][0-9]{2})(?: .*|)$/.exec(statusLine)
  if (headerEnd < 0 || !status) throw new Error('Resposta HTTP invalida.')

  const body = raw.subarray(headerEnd + 4)
  const length = /^Content-Length:[ \t]*(\d+)[ \t]*\r?$/im.exec(raw.toString('ascii', 0, headerEnd))
  if (length && Number(length[1]) !== body.length) throw new Error('Corpo da resposta HTTP incompleto ou invalido.')
  return { status: Number(status[1]), body }
}

function reportDebugEnvironment() {
  if (!terminalId) process.stderr.write('MAESTRI_TERMINAL_ID e OMAESTRI_TERMINAL_ID ausentes.\n')
  if (!process.env.MAESTRI_PIPE) process.stderr.write('MAESTRI_PIPE ausente; usando omaestri-agent.\n')
  if (!process.env.MAESTRI_SERVER_PORT) {
    process.stderr.write('MAESTRI_SERVER_PORT ausente; fallback TCP desativado.\n')
  } else if (!hasTcpPort) {
    process.stderr.write('MAESTRI_SERVER_PORT invalido; fallback TCP desativado.\n')
  }
  if (!process.env.MAESTRI_CLI) process.stderr.write('MAESTRI_CLI ausente; executando diretamente.\n')
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]
  if (!command || ['help', '--help', '-h'].includes(command)) {
    process.stdout.write(USAGE)
    return
  }

  if (command === 'debug') {
    reportDebugEnvironment()
  } else if (!terminalId) {
    throw new Error('MAESTRI_TERMINAL_ID ausente. Execute dentro do open-maestri ou defina OMAESTRI_TERMINAL_ID.')
  }
  if (/[\r\n]/.test(terminalId)) throw new Error('ID do terminal invalido.')

  const { status, body } = parseResponse(await send(buildRequest(args)))
  if (status === 200) {
    process.stdout.write(body)
  } else {
    process.stderr.write(body.length ? body : `Erro HTTP ${status}.\n`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  process.stderr.write(`error: ${error.message}\n`)
  process.exitCode = 1
})
