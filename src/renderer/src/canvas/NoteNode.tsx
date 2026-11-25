/**
 * No de nota Markdown.
 *
 * O conteudo vive em `notes/<fileName>` dentro do diretorio do workspace; o
 * `workspace.json` guarda apenas a referencia. Edicao vai ao main (que faz a
 * escrita atomica) — o renderer nunca toca no disco.
 */

import { Marked } from 'marked'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { StickyNoteContent } from '@shared/models/node-content'

import { api } from '../api'
import { useCanvasStore } from '../store'

interface Props {
  content: StickyNoteContent
  active: boolean
  previewing?: boolean
}

type Phase = 'loading' | 'ready' | 'error'

const escapeHtml = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const markdown = new Marked({
  renderer: {
    html: ({ text }) => escapeHtml(text),
    link({ tokens }) {
      return `<span class="note-markdown-link">${this.parser.parseInline(tokens)}</span>`
    },
    image: ({ text }) => escapeHtml(text),
  },
})

export function NoteNode(props: Props): React.JSX.Element {
  const workspaceId = useCanvasStore((state) => state.document?.payload.id)
  return <NoteEditor key={JSON.stringify([workspaceId, props.content.fileName])} {...props} workspaceId={workspaceId} />
}

function NoteEditor({
  content, active, previewing = content.isPreviewing, workspaceId,
}: Props & { workspaceId?: string }): React.JSX.Element {
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState<string | undefined>(undefined)
  const [saveError, setSaveError] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pendingText = useRef<string | undefined>(undefined)
  const revision = useRef(0)
  const writesInFlight = useRef(0)
  const afterSave = useRef<(() => void) | undefined>(undefined)

  const fileName = content.fileName
  const html = useMemo(() => {
    if (!previewing) return ''
    const normalized = text.replace(/^[\uFEFF\u200B]+/, '').replace(/\r\n?|[\u2028\u2029]/g, '\n')
    return markdown.parse(normalized, { async: false })
  }, [previewing, text])

  useEffect(() => {
    if (!fileName || !active) return
    let cancelled = false
    let loaded = false
    let deferred = false
    let readId = 0

    const reload = (): void => {
      if (cancelled || useCanvasStore.getState().document?.payload.id !== workspaceId) return
      if (pendingText.current !== undefined || writesInFlight.current !== 0) {
        deferred = true
        return
      }
      deferred = false
      const requestId = ++readId
      const readRevision = revision.current
      const canApply = (): boolean => {
        if (cancelled || requestId !== readId || useCanvasStore.getState().document?.payload.id !== workspaceId) {
          return false
        }
        if (revision.current === readRevision) return true
        reload()
        return false
      }
      void api.note.read({ fileName }).then(
        (value) => {
          if (!canApply()) return
          loaded = true
          setError(undefined)
          setText(value)
          setPhase('ready')
        },
        (cause: unknown) => {
          if (!canApply()) return
          setError(cause instanceof Error ? cause.message : String(cause))
          if (!loaded) setPhase('error')
        },
      )
    }

    afterSave.current = () => { if (deferred) reload() }
    const unsubscribe = api.note.onChanged((event) => {
      if (event.fileName === fileName) reload()
    })
    setPhase('loading')
    reload()
    return () => {
      cancelled = true
      afterSave.current = undefined
      unsubscribe()
    }
  }, [fileName, active, workspaceId])

  const flushSave = useCallback(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = undefined
    const value = pendingText.current
    pendingText.current = undefined
    if (value === undefined || !fileName || useCanvasStore.getState().document?.payload.id !== workspaceId) return
    const savedRevision = revision.current
    writesInFlight.current++
    void api.note.write({ fileName, content: value }).then(
      () => { if (revision.current === savedRevision) setSaveError(false) },
      () => {
        if (revision.current !== savedRevision) return
        pendingText.current = value
        setSaveError(true)
      },
    ).finally(() => {
      writesInFlight.current--
      afterSave.current?.()
    })
  }, [fileName, workspaceId])

  // Debounce: cada tecla nao pode virar um write atomico.
  const onChange = useCallback(
    (value: string) => {
      setText(value)
      setSaveError(false)
      revision.current++
      pendingText.current = value
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(flushSave, 400)
    },
    [flushSave],
  )

  // Grava o pendente antes de sair: sem isso as ultimas teclas se perdem.
  useEffect(() => flushSave, [flushSave])

  useEffect(() => {
    if (previewing) flushSave()
  }, [previewing, flushSave])

  if (!fileName) {
    return <div className="node-muted">Nota sem arquivo associado</div>
  }

  if (phase === 'error') {
    return <div className="node-note-error">{error}</div>
  }

  if (phase === 'loading') return <div className="node-note-placeholder">Carregando nota...</div>

  return (
    <div className="node-note-content" onWheel={(event) => { if (!event.ctrlKey) event.stopPropagation() }}>
      {saveError && <div className="node-note-error" role="status">Erro ao salvar nota.</div>}
      {error && <div className="node-note-error" role="status">Erro ao atualizar nota: {error}</div>}
      {previewing ? (
        html ? (
          <div className="node-note-preview" style={{ fontSize: content.fontSize }}
            dangerouslySetInnerHTML={{ __html: html }} />
        ) : <div className="node-note-placeholder">Nota vazia</div>
      ) : (
        <textarea
          className="node-note-editor"
          aria-label="Editar Markdown"
          value={text}
          onChange={(event) => onChange(event.target.value)}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onBlur={flushSave}
          spellCheck={false}
          placeholder="Escreva em Markdown..."
          style={{ fontSize: content.fontSize }}
        />
      )}
    </div>
  )
}
