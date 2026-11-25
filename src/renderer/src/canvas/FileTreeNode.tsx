/**
 * No de file tree — navega um diretorio do usuario.
 *
 * Carrega um nivel por vez (nao varre a arvore inteira): uma pasta grande
 * demora segundos e trava a interface.
 */

import { useCallback, useEffect, useState } from 'react'

import type { FileTreeContent } from '@shared/models/node-content'
import type { FileTreeEntry } from '@shared/ipc-contract'

import { api } from '../api'

interface Props {
  content: FileTreeContent
  active: boolean
}

interface Level {
  relativePath: string
  entries: FileTreeEntry[]
}

function parentOf(path: string): string | undefined {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  if (index < 0) return undefined
  return normalized.slice(0, index)
}

export function FileTreeNode({ content, active }: Props): React.JSX.Element {
  const [relativePath, setRelativePath] = useState('')
  const [level, setLevel] = useState<Level | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  /** Incrementa a cada evento do watcher, forçando o refetch abaixo. */
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setError(undefined)
    void api.fileTree.list({ rootPath: content.rootPath, relativePath }).then((result) => {
      if (cancelled) return
      if (result.error) {
        setError(result.error)
        setLevel(undefined)
        return
      }
      setLevel({ relativePath: result.relativePath, entries: result.entries })
    })
    return () => {
      cancelled = true
    }
  }, [active, content.rootPath, relativePath, revision])

  // O disco mudou (agente criou arquivo, git checkout, npm install): recarrega
  // a pasta visivel. Sem isso o no fica congelado ate remontar.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    void api.fileTree.watch({ rootPath: content.rootPath, relativePath })
    const off = api.fileTree.onChanged((event) => {
      if (cancelled) return
      // O watcher observa a raiz do no; um evento em outra pasta nao muda esta.
      if (event.rootPath !== content.rootPath) return
      setRevision((value) => value + 1)
    })
    return () => {
      cancelled = true
      off()
      // Nao chamar unwatch aqui: o watcher e por raiz, e varias instancias do
      // mesmo nó (remontagens do StrictMode) compartilham um. O encerramento
      // fica com `closeAllDirectoryWatchers` no shutdown do app.
    }
  }, [active, content.rootPath, relativePath])

  const goUp = useCallback(() => {
    const parent = parentOf(relativePath)
    setRelativePath(parent ?? '')
  }, [relativePath])

  return (
    <div className="node-filetree">
      <div className="node-filetree-bar">
        <button
          type="button"
          className="node-filetree-up"
          onClick={goUp}
          disabled={relativePath === ''}
          onPointerDown={(e) => e.stopPropagation()}
          title="Subir um nivel"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M8 3.5 3 8.5h3v4h4v-4h3L8 3.5Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <span className="node-filetree-path">{relativePath || content.rootPath}</span>
      </div>

      {error ? <div className="node-filetree-error">{error}</div> : null}

      <ul className="node-filetree-list">
        {level?.entries.map((entry) => (
          <li key={entry.path}>
            <button
              type="button"
              className={`node-filetree-item${entry.isDirectory ? ' is-dir' : ''}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                if (entry.isDirectory) setRelativePath(entry.path.replace(/\\/g, '/'))
              }}
              title={entry.path}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                {entry.isDirectory ? (
                  <path
                    d="M2 4.5h4l1 1.5h6.5v6.5h-11v-8Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinejoin="round"
                  />
                ) : (
                  <path
                    d="M4 2.5h5l3 3v8H4v-11Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinejoin="round"
                  />
                )}
              </svg>
              <span>{entry.name}</span>
            </button>
          </li>
        ))}
        {level && level.entries.length === 0 && !error ? (
          <li className="node-muted">(vazio)</li>
        ) : null}
      </ul>
    </div>
  )
}
