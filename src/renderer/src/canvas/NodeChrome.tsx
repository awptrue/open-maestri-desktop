import type { PointerEventHandler } from 'react'

import type { NodeContentType, TerminalStatus } from '@shared/models/node-content'

interface Props {
  type: NodeContentType
  label: string
  status?: TerminalStatus
  previewing?: boolean
  onTogglePreview?: () => void
  onDrag: PointerEventHandler<HTMLDivElement>
  onConnectStart?: PointerEventHandler<HTMLButtonElement>
  onConnectMove?: PointerEventHandler<HTMLButtonElement>
  onConnectEnd?: PointerEventHandler<HTMLButtonElement>
  onConnectCancel?: PointerEventHandler<HTMLButtonElement>
}

const TYPE_ICON: Record<NodeContentType, string> = {
  terminal: 'm3 4 4 4-4 4m6 0h4',
  stickyNote: 'M4 2h8v8l-4 4H4zM8 14v-4h4M6 5h4M6 8h2',
  fileTree: 'M2 5V3h5l2 2h5v8H2z',
  portal: 'M2 3h12v10H2zM2 6h12',
  text: 'M3 4h10M8 4v8M6 12h4',
  shape: 'M8 2 14 13H2z',
  stroke: 'm2 12 12-8',
  freehand: 'M2 12c3 0 3-8 6-8s2 6 6 6',
}

function Icon({ path }: { path: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.35"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  )
}

export function NodeChrome({
  type, label, status, previewing, onTogglePreview, onDrag,
  onConnectStart, onConnectMove, onConnectEnd, onConnectCancel,
}: Props): React.JSX.Element {
  const previewLabel = previewing ? 'Editar Markdown' : 'Previa Markdown'
  return (
    <div className="node-header" onPointerDown={onDrag}>
      <span className="node-glyph"><Icon path={TYPE_ICON[type]} /></span>
      <span className="node-title" title={label}>{label}</span>
      {status && (
        <span className={`node-status node-status--${status}`}>
          <span className="node-status-dot" aria-hidden="true" />
          {status === 'running' ? 'Em atividade' : 'Ocioso'}
        </span>
      )}
      {onTogglePreview && (
        <button type="button" className="node-chrome-button" aria-label="Previa Markdown"
          aria-pressed={previewing} title={previewLabel} onClick={onTogglePreview}
          onPointerDown={(event) => event.stopPropagation()}>
          <Icon path="M1.5 8s2-4 6.5-4 6.5 4 6.5 4-2 4-6.5 4-6.5-4-6.5-4zm8 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z" />
        </button>
      )}
      {onConnectStart && (
        <button type="button" className="node-chrome-button node-connect-handle"
          aria-label={`Arrastar para conectar: ${label}`} title="Arraste para conectar a outro no"
          onPointerDown={onConnectStart} onPointerMove={onConnectMove} onPointerUp={onConnectEnd}
          onPointerCancel={onConnectCancel} onLostPointerCapture={onConnectCancel}>
          <Icon path="M5 6 6.5 4.5a3 3 0 0 1 4.25 4.25L9.5 10m1.5 0-1.5 1.5a3 3 0 0 1-4.25-4.25L6.5 6m0 3.5 3-3" />
        </button>
      )}
    </div>
  )
}
