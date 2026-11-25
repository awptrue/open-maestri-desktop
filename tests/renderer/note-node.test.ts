import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement, type ComponentType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MaestriBridgeApi, NoteChangedEvent } from '@shared/ipc-contract'
import { createStickyNoteContent, type StickyNoteContent } from '@shared/models/node-content'

const noteApi = vi.hoisted(() => ({
  read: vi.fn<MaestriBridgeApi['note']['read']>(),
  write: vi.fn<MaestriBridgeApi['note']['write']>(),
  onChanged: vi.fn<MaestriBridgeApi['note']['onChanged']>(),
}))

vi.mock('@renderer/api', () => ({ api: { note: noteApi } }))

const { NoteNode } = await vi.importActual<{
  NoteNode: ComponentType<{ content: StickyNoteContent; active: boolean; previewing?: boolean }>
}>('@renderer/canvas/NoteNode')

const content = createStickyNoteContent('Nota')
const unsubscribe = vi.fn()
let emitChanged: (event: NoteChangedEvent) => void

function deferred<Value>(): { promise: Promise<Value>; resolve: (value: Value) => void } {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  noteApi.read.mockReset().mockResolvedValue('# Original')
  noteApi.write.mockReset().mockResolvedValue(undefined)
  unsubscribe.mockClear()
  noteApi.onChanged.mockReset().mockImplementation((listener) => {
    emitChanged = listener
    return unsubscribe
  })
})

afterEach(() => cleanup())

describe('NoteNode', () => {
  it.each(['\n', '\r\n', '\u2028'])('renderiza bloco cercado com separador %j', async (separator) => {
    const fence = '```'
    noteApi.read.mockResolvedValue(['\uFEFF' + fence + 'ts', 'const x = 1', fence].join(separator))
    render(createElement(NoteNode, { content, active: true, previewing: true }))

    expect(await screen.findByText('const x = 1', { selector: 'pre > code.language-ts' })).toBeTruthy()
    expect(noteApi.write).not.toHaveBeenCalled()
  })

  it('ignora outras notas e recarrega a nota certa sem sair da previa', async () => {
    const view = render(createElement(NoteNode, { content, active: true, previewing: true }))
    await screen.findByRole('heading', { name: 'Original' })
    emitChanged({ fileName: 'Outra.md' })
    expect(noteApi.read).toHaveBeenCalledTimes(1)

    noteApi.read.mockResolvedValue('# Titulo externo')
    emitChanged({ fileName: 'Nota.md' })
    expect(await screen.findByRole('heading', { name: 'Titulo externo' })).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('mantem o editor e descarta uma resposta ultrapassada por outra leitura', async () => {
    render(createElement(NoteNode, { content, active: true }))
    await screen.findByDisplayValue('# Original')
    const oldRead = deferred<string>()
    noteApi.read.mockReturnValueOnce(oldRead.promise).mockResolvedValue('# Mais recente')
    emitChanged({ fileName: 'Nota.md' })
    emitChanged({ fileName: 'Nota.md' })
    await screen.findByDisplayValue('# Mais recente')

    await act(async () => oldRead.resolve('# Atrasado'))
    expect(screen.getByDisplayValue('# Mais recente')).toBe(screen.getByRole('textbox'))
  })

  it('preserva rascunho contra leitura pendente e adia nova leitura ate o salvamento', async () => {
    render(createElement(NoteNode, { content, active: true }))
    const editor = await screen.findByDisplayValue('# Original')
    const oldRead = deferred<string>()
    const save = deferred<void>()
    noteApi.read.mockReturnValueOnce(oldRead.promise)
    noteApi.write.mockReturnValueOnce(save.promise)

    emitChanged({ fileName: 'Nota.md' })
    fireEvent.change(editor, { target: { value: '# Rascunho' } })
    fireEvent.blur(editor)
    emitChanged({ fileName: 'Nota.md' })
    await act(async () => oldRead.resolve('# Atrasado'))
    expect(screen.getByDisplayValue('# Rascunho')).toBe(editor)
    expect(noteApi.read).toHaveBeenCalledTimes(2)
    expect(noteApi.write).toHaveBeenCalledExactlyOnceWith({ fileName: 'Nota.md', content: '# Rascunho' })

    noteApi.read.mockResolvedValue('# Gravado depois')
    await act(async () => save.resolve(undefined))
    expect(await screen.findByDisplayValue('# Gravado depois')).toBe(editor)
  })
})
