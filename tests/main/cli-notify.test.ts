/**
 * Comando `notify` do roteador do CLI `omaestri`.
 *
 * O roteador aceita `notifier` injetado justamente para que o caminho de
 * notificacao do sistema seja verificavel sem app do Electron aberto. Aqui o
 * notificador e um duble que registra as chamadas; `store`, `terminals` e
 * `persistence` sao dublês vazios porque `notify` nao os consulta.
 */
import { describe, expect, it } from 'vitest'

import type { PersistenceManager } from '../../src/main/persistence/persistence-manager'
import type { TerminalManager } from '../../src/main/terminal/terminal-manager'
import type { WorkspaceStore } from '../../src/main/workspace/workspace-store'
import { createRouter, type Notifier } from '../../src/main/ipc-server/router'

interface NotifierSpy {
  notifier: Notifier
  /** Quantas vezes `isSupported` foi chamado (0 = roteador nem tocou no duble). */
  supportedCalls: number
  /** Argumentos de cada `show`, na ordem. */
  shows: Array<[title: string, body: string]>
}

function makeNotifier(options: { supported?: boolean; show?: Notifier['show'] } = {}): NotifierSpy {
  const spy: NotifierSpy = {
    supportedCalls: 0,
    shows: [],
    notifier: {
      isSupported: () => {
        spy.supportedCalls++
        return options.supported ?? true
      },
      show: async (title, body) => {
        spy.shows.push([title, body])
        await options.show?.(title, body)
      },
    },
  }
  return spy
}

function makeRouter(notifier: Notifier) {
  return createRouter({
    store: {} as unknown as WorkspaceStore,
    terminals: {} as unknown as TerminalManager,
    persistence: {} as unknown as PersistenceManager,
    notifier,
  })
}

describe('notify', () => {
  it('exige mensagem e nao toca no notificador', async () => {
    const spy = makeNotifier()
    const router = makeRouter(spy.notifier)

    expect(await router(['notify'])).toBe('error: uso: omaestri notify "mensagem"')
    expect(await router(['notify', ''])).toBe('error: uso: omaestri notify "mensagem"')
    expect(spy.supportedCalls).toBe(0)
    expect(spy.shows).toEqual([])
  })

  it('recusa quando isSupported devolve false de forma sincrona', async () => {
    const spy = makeNotifier({ supported: false })
    const router = makeRouter(spy.notifier)

    expect(await router(['notify', 'mensagem'])).toBe(
      'error: notificacoes nao suportadas neste sistema.',
    )
    expect(spy.supportedCalls).toBe(1)
    expect(spy.shows).toEqual([])
  })

  it('mostra a notificacao com titulo fixo quando suportado', async () => {
    const spy = makeNotifier()
    const router = makeRouter(spy.notifier)

    expect(await router(['notify', 'build terminou'])).toBe('ok: notificacao enviada')
    expect(spy.shows).toEqual([['open-maestri', 'build terminou']])
  })

  it('acrescenta " (de <ID>)" ao corpo quando ha terminalId', async () => {
    const spy = makeNotifier()
    const router = makeRouter(spy.notifier)

    expect(await router(['notify', 'build terminou'], 'CCCC-DDDD')).toBe(
      'ok: notificacao enviada',
    )
    expect(spy.shows).toEqual([['open-maestri', 'build terminou (de CCCC-DDDD)']])
  })

  it('converte falha de show em error sem propagar a excecao', async () => {
    const spy = makeNotifier({
      show: () => {
        throw new Error('servico de notificacao fora do ar')
      },
    })
    const router = makeRouter(spy.notifier)

    const result = await router(['notify', 'oi'])
    expect(result.startsWith('error: notificacao indisponivel: ')).toBe(true)
    expect(result).toContain('servico de notificacao fora do ar')
    expect(spy.shows).toEqual([['open-maestri', 'oi']])
  })

  it('nao anexa sufixo de terminal quando terminalId nao e passado', async () => {
    const spy = makeNotifier()
    const router = makeRouter(spy.notifier)

    await router(['notify', 'oi'], undefined)
    expect(spy.shows[0]?.[1]).toBe('oi')
  })
})
