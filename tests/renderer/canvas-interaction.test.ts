import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CANVAS_MAX_ZOOM } from '@shared/constants'
import { createStickyNoteContent, createTerminalContent, createTextContent } from '@shared/models/node-content'
import { createCanvasNode, createWorkspaceDocument, createWorkspacePayload } from '@shared/models/workspace'
import { api } from '@renderer/api'
import { App } from '@renderer/App'
import { Viewport } from '@renderer/canvas/Viewport'
import { screenToWorld, useCanvasStore, worldToScreen } from '@renderer/store'

vi.mock('@renderer/canvas/TerminalNode', () => ({ TerminalNode: () => null }))

const origin = { x: 1000, y: 2000 }

beforeEach(() => {
  useCanvasStore.setState({ viewport: { origin, zoom: 2 } })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  useCanvasStore.setState(useCanvasStore.getInitialState(), true)
})

function renderViewport(children = createElement('textarea')): HTMLElement {
  const { container } = render(createElement(Viewport, { children }))
  const viewport = container.querySelector<HTMLElement>('.canvas-viewport')!
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(30, 60, 800, 600))
  Object.assign(viewport, { setPointerCapture: vi.fn(), hasPointerCapture: () => false })
  return viewport
}

describe('viewport do canvas', () => {
  it('mantem o ponto sob o cursor ao dar zoom ate o limite', () => {
    useCanvasStore.setState({ viewport: { origin, zoom: 2.9 } })
    const viewport = renderViewport()
    const anchor = { x: 140, y: 110 }
    const before = screenToWorld(useCanvasStore.getState().viewport, anchor)

    fireEvent.wheel(viewport, { clientX: 170, clientY: 170, deltaY: -80 })

    const after = useCanvasStore.getState().viewport
    const projected = worldToScreen(after, before)
    expect(after.zoom).toBe(CANVAS_MAX_ZOOM)
    expect(projected.x).toBeCloseTo(anchor.x)
    expect(projected.y).toBeCloseTo(anchor.y)
  })

  it('nao altera o zoom com roda exclusivamente horizontal', () => {
    const viewport = renderViewport()
    fireEvent.wheel(viewport, { deltaX: 40, deltaY: 0 })
    expect(useCanvasStore.getState().viewport).toEqual({ origin, zoom: 2 })
  })

  it('move o conteudo no sentido e na distancia do arrasto com zoom', () => {
    const viewport = renderViewport()
    const world = { x: 1040, y: 2020 }
    const before = worldToScreen(useCanvasStore.getState().viewport, world)

    fireEvent.pointerDown(viewport, { button: 1, pointerId: 1, clientX: 150, clientY: 120 })
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 190, clientY: 100 })
    fireEvent.pointerUp(viewport, { button: 1, pointerId: 1 })

    expect(worldToScreen(useCanvasStore.getState().viewport, world)).toEqual({
      x: before.x + 40,
      y: before.y - 20,
    })
  })

  it.each(['+', '=', '-', '_', ' '])('preserva %j ao digitar na nota', (key) => {
    renderViewport()
    const handledByEditor = fireEvent.keyDown(screen.getByRole('textbox'), { key, code: key === ' ' ? 'Space' : '' })
    expect(handledByEditor).toBe(true)
    expect(useCanvasStore.getState().viewport).toEqual({ origin, zoom: 2 })
    expect(document.body.style.cursor).toBe('')
  })
})

async function renderApp(nodes: ReturnType<typeof createCanvasNode>[] = []): Promise<void> {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  })
  const payload = createWorkspacePayload('workspace', 'Workspace de teste', 'C:/Projeto')
  Object.assign(payload, { nodes, canvasOrigin: origin, canvasZoom: 1 })
  vi.spyOn(api.workspace, 'open').mockResolvedValue({ document: createWorkspaceDocument(payload), isDirty: false })
  render(createElement(App))
  await screen.findByText('Workspace de teste')
}

describe('controles do canvas', () => {
  it('alterna selecao com Shift e limpa ao clicar no fundo', async () => {
    const first = createCanvasNode('first', { ...origin, width: 60, height: 60 }, { type: 'text', value: createTextContent('Primeiro') })
    const second = createCanvasNode('second', { ...origin, x: origin.x + 80, width: 60, height: 60 }, { type: 'text', value: createTextContent('Segundo') })
    await renderApp([first, second])

    fireEvent.pointerDown(screen.getByRole('group', { name: 'text: Primeiro' }), { button: 0 })
    expect(screen.getByText('1 selecionado(s)')).toBeTruthy()
    fireEvent.pointerDown(screen.getByRole('group', { name: 'text: Segundo' }), { button: 0, shiftKey: true })
    expect(screen.getByText('2 selecionado(s)')).toBeTruthy()
    fireEvent.pointerDown(screen.getByText('Primeiro'), { button: 0, shiftKey: true })
    expect(screen.getByText('1 selecionado(s)')).toBeTruthy()

    const background = document.querySelector('.canvas-world')!
    fireEvent.pointerDown(background, { button: 0 })
    fireEvent.pointerUp(background, { button: 0 })
    fireEvent.click(background)
    expect(screen.getByText('0 selecionado(s)')).toBeTruthy()
  })

  it('altera o zoom pelos botoes da toolbar', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '+' }))
    expect(screen.getByText('125%')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '-' }))
    expect(screen.getByText('100%')).toBeTruthy()
  })

  it.each([
    { button: '+ terminal', content: { type: 'terminal', value: createTerminalContent('Terminal', 'C:/Projeto') } },
    { button: '+ nota', content: { type: 'stickyNote', value: createStickyNoteContent('Nota') } },
    { button: '+ texto', content: { type: 'text', value: createTextContent('Texto') } },
  ] as const)('cria e seleciona o no pelo botao $button', async ({ button, content }) => {
    const addNode = vi.spyOn(api.workspace, 'addNode').mockImplementation(async ({ frame }) => (
      createCanvasNode('new-node', frame, content)
    ))
    await renderApp()

    fireEvent.click(screen.getByRole('button', { name: button }))

    expect(addNode).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      type: content.type,
      frame: expect.objectContaining({ x: origin.x + 100, y: origin.y + 100 }),
    }))
    await waitFor(() => expect(useCanvasStore.getState().selectedIds).toEqual(new Set(['new-node'])))
    expect(screen.getByText('1 nos')).toBeTruthy()
  })
})
