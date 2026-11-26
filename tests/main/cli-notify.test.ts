/**
 * Comando `notify` do roteador do CLI `omaestri`.
 *
 * O roteador aceita `notifier` injetado justamente para que o caminho de
 * notificacao do sistema seja verificavel sem app do Electron aberto. Aqui o
 * notificador e um duble que registra as chamadas; `store`, `terminals` e
 * `persistence` sao dublês vazios porque `notify` nao os consulta.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PersistenceManager } from '../../src/main/persistence/persistence-manager'
import type { TerminalManager } from '../../src/main/terminal/terminal-manager'
import type { WorkspaceStore } from '../../src/main/workspace/workspace-store'
import {
  createRouter,
  electronNotifier,
  NOTIFICATION_DIAGNOSTIC_WINDOW_MS,
  type NativeNotificationClass,
  type Notifier,
} from '../../src/main/ipc-server/router'

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

// ---------------------------------------------------------------------------
// Caminho real (electronNotifier) com Electron dublado
// ---------------------------------------------------------------------------

/** Dublê minimo da Notification do Electron 45: `failed` (event, error). */
class FakeNativeNotification {
  static supported = true
  static failureOnShow: string | undefined
  static showError: string | undefined
  static createError: string | undefined
  static instances: FakeNativeNotification[] = []

  readonly options: { title: string; body: string }
  readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  showCalls = 0

  constructor(options: { title: string; body: string }) {
    if (FakeNativeNotification.createError) {
      throw new Error(FakeNativeNotification.createError)
    }
    this.options = options
    FakeNativeNotification.instances.push(this)
  }

  static isSupported(): boolean {
    return FakeNativeNotification.supported
  }

  static reset(): void {
    FakeNativeNotification.supported = true
    FakeNativeNotification.failureOnShow = undefined
    FakeNativeNotification.showError = undefined
    FakeNativeNotification.createError = undefined
    FakeNativeNotification.instances = []
  }

  on(event: string, listener: (...args: unknown[]) => void): this {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
    return this
  }

  show(): void {
    this.showCalls++
    if (FakeNativeNotification.showError) {
      throw new Error(FakeNativeNotification.showError)
    }
    if (FakeNativeNotification.failureOnShow) {
      this.emit('failed', {}, FakeNativeNotification.failureOnShow)
    }
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

function makeElectronNotifier(warnings: string[]) {
  return electronNotifier({
    load: async () => FakeNativeNotification as unknown as NativeNotificationClass,
    warn: (message) => warnings.push(message),
  })
}

describe('electronNotifier', () => {
  it('registra a falha nativa sem expor o corpo da mensagem', async () => {
    FakeNativeNotification.reset()
    const warnings: string[] = []
    const notifier = makeElectronNotifier(warnings)

    await notifier.show('open-maestri', 'corpo que nao pode ir para o log')
    const native = FakeNativeNotification.instances[0]
    expect(native?.showCalls).toBe(1)

    native?.emit('failed', {}, 'elemento nao encontrado')
    expect(warnings).toEqual(['notificacao nativa falhou: elemento nao encontrado'])
    expect(warnings[0]).not.toContain('corpo que nao pode ir para o log')
  })

  it('mantem ok quando a falha nativa chega durante o show', async () => {
    FakeNativeNotification.reset()
    FakeNativeNotification.failureOnShow = 'acesso negado'
    const warnings: string[] = []
    const router = makeRouter(makeElectronNotifier(warnings))

    expect(await router(['notify', 'oi'])).toBe('ok: notificacao enviada')
    expect(warnings).toEqual(['notificacao nativa falhou: acesso negado'])
  })
})

describe('retencao de diagnostico', () => {
  afterEach(() => {
    vi.useRealTimers()
    FakeNativeNotification.reset()
  })

  it('solta a notificacao quando a janela de diagnostico expira', async () => {
    vi.useFakeTimers()
    FakeNativeNotification.reset()
    const notifier = makeElectronNotifier([])

    await notifier.show('open-maestri', 'oi')
    expect(vi.getTimerCount()).toBe(1)

    vi.advanceTimersByTime(NOTIFICATION_DIAGNOSTIC_WINDOW_MS)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancela o timer e solta a referencia no failed', async () => {
    vi.useFakeTimers()
    FakeNativeNotification.reset()
    const warnings: string[] = []
    const notifier = makeElectronNotifier(warnings)

    await notifier.show('open-maestri', 'oi')
    FakeNativeNotification.instances[0]?.emit('failed', {}, 'falha nativa')

    expect(vi.getTimerCount()).toBe(0)
    expect(warnings).toEqual(['notificacao nativa falhou: falha nativa'])
  })

  it('cancela o timer no close', async () => {
    vi.useFakeTimers()
    FakeNativeNotification.reset()
    const notifier = makeElectronNotifier([])

    await notifier.show('open-maestri', 'oi')
    FakeNativeNotification.instances[0]?.emit('close')

    expect(vi.getTimerCount()).toBe(0)
  })

  it('nao retem referencia quando show lanca', async () => {
    vi.useFakeTimers()
    FakeNativeNotification.reset()
    FakeNativeNotification.showError = 'show falhou'
    const router = makeRouter(makeElectronNotifier([]))

    const result = await router(['notify', 'oi'])
    expect(result.startsWith('error: notificacao indisponivel: ')).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('nao retem referencia quando o construtor lanca', async () => {
    vi.useFakeTimers()
    FakeNativeNotification.reset()
    FakeNativeNotification.createError = 'construtor falhou'
    const router = makeRouter(makeElectronNotifier([]))

    const result = await router(['notify', 'oi'])
    expect(result.startsWith('error: notificacao indisponivel: ')).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
