/**
 * No de terminal — xterm.js ligado ao PTY do processo main.
 *
 * Fluxo: `terminal.create` (idempotente por `TerminalContent.id`) -> o main
 * devolve o que ja saiu do processo -> `onData` alimenta o xterm daqui para
 * frente. Teclado vai por `terminal.input`; redimensionamento por
 * `terminal.resize`.
 *
 * O terminal NAO pertence ao no: a chave e o id do `TerminalContent`, porque e
 * esse id que as conexoes e o CLI usam para achar o agente.
 */

import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

import type { TerminalContent } from '@shared/models/node-content'
import type { TerminalExitEvent } from '@shared/ipc-contract'

import { api } from '../api'
import { TERMINAL_THEME } from './terminal-theme'

interface Props {
  content: TerminalContent
  /** Só monta o PTY quando o no esta visivel: 20 shells ocultos consomem RAM. */
  active: boolean
}

type Phase = 'idle' | 'starting' | 'running' | 'exited' | 'failed'

export function TerminalNode({ content, active }: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | undefined>(undefined)
  const fitRef = useRef<FitAddon | undefined>(undefined)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    const host = hostRef.current
    if (!host || !active) return

    let disposed = false
    const term = new Terminal({
      fontFamily: "'Cascadia Mono', 'Consolas', monospace",
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      convertEol: false,
      scrollback: 5000,
      theme: TERMINAL_THEME,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    termRef.current = term
    fitRef.current = fit

    const safeFit = (): { cols: number; rows: number } => {
      try {
        fit.fit()
      } catch {
        // Container com 0x0 (no oculto ou ainda sem layout): mantem o default.
      }
      return { cols: term.cols || 80, rows: term.rows || 24 }
    }

    const initial = safeFit()
    setPhase('starting')

    let offData: (() => void) | undefined
    let offExit: (() => void) | undefined

    void (async () => {
      const result = await api.terminal.create({
        terminalId: content.id,
        agentType: content.agentType,
        command: content.command,
        workingDirectory: content.workingDirectory,
        shellPath: content.shellPath || undefined,
        cols: initial.cols,
        rows: initial.rows,
      })
      if (disposed) return

      if (!result.running) {
        setPhase('failed')
        setError(result.error ?? 'PTY nao iniciou')
        term.writeln(`\x1b[31m${result.error ?? 'PTY nao iniciou'}\x1b[0m`)
        return
      }

      setPhase('running')
      // O snapshot cobre tudo ate `result.seq`. Eventos com seq menor ou igual
      // sao o mesmo trecho: escrever os dois duplicaria a saida na tela.
      if (result.initialChunk) term.write(result.initialChunk)
      let appliedSeq = result.seq

      offData = api.terminal.onData(({ terminalId, data, seq }) => {
        if (terminalId !== content.id) return
        if (seq <= appliedSeq) return
        appliedSeq = seq
        term.write(data)
      })
      offExit = api.terminal.onExit(({ terminalId, exitCode }: TerminalExitEvent) => {
        if (terminalId !== content.id) return
        setPhase('exited')
        term.writeln(`\r\n\x1b[90m[processo encerrado: codigo ${exitCode}]\x1b[0m`)
      })
    })()

    const dataSub = term.onData((data) => {
      void api.terminal.input({ terminalId: content.id, data })
      void api.terminal.setActive(content.id)
    })

    // Redimensionar o no muda cols/rows do PTY; sem isso o programa desenha
    // errado (barra de progresso, cursor, tabelas).
    const observer = new ResizeObserver(() => {
      if (disposed) return
      const { cols, rows } = safeFit()
      void api.terminal.resize({ terminalId: content.id, cols, rows })
    })
    observer.observe(host)

    return () => {
      disposed = true
      observer.disconnect()
      dataSub.dispose()
      offData?.()
      offExit?.()
      term.dispose()
      termRef.current = undefined
      fitRef.current = undefined
      // Nao destruir o PTY aqui: desmontar por culling (pan) mataria o agente.
    }
  }, [active, content.id, content.agentType, content.command, content.workingDirectory, content.shellPath])

  return (
    <div className="node-terminal">
      <div className="node-terminal-host" ref={hostRef} />
      {phase === 'failed' ? <div className="node-terminal-error">{error}</div> : null}
    </div>
  )
}
