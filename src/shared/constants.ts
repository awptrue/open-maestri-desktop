/**
 * Constantes globais espelhadas de `Sources/Shared/Constants.swift` do
 * open-maestri original. Valores numericos sao parte do contrato de
 * compatibilidade — nao altere sem conferir o Swift.
 */

export const SCHEMA_VERSION = 2
export const APP_STATE_SCHEMA_VERSION = 1
export const MANIFEST_SCHEMA_VERSION = 1
export const PREFERENCES_SCHEMA_VERSION = 1

export const APP_DATA_DIRECTORY_NAME = '.open-maestri'

/** Origem inicial do canvas — identica ao macOS, para que o mesmo workspace
 *  abra no mesmo enquadramento nos dois sistemas. */
export const CANVAS_INITIAL_ORIGIN = { x: 9800, y: 8500 } as const

export const CANVAS_MIN_ZOOM = 0.1
export const CANVAS_MAX_ZOOM = 3.0
export const CANVAS_ZOOM_STEP = 0.25
export const CANVAS_GRID_SPACING = 16

export const ROPE_CONTROL_POINT_COUNT = 21
export const ROPE_BEND_RATIO_MIN = 1.08
export const ROPE_BEND_RATIO_MAX = 1.15

export const TERMINAL_MIN_WIDTH = 200
export const TERMINAL_MIN_HEIGHT = 100
export const NOTE_MIN_WIDTH = 120
export const NOTE_MIN_HEIGHT = 80
export const NOTE_DEFAULT_WIDTH = 260
export const NOTE_DEFAULT_HEIGHT = 150
export const NOTE_DEFAULT_COLOR = '#FEFDE8'

export const DEFAULT_FONT_FAMILY = 'system'
export const DEFAULT_FONT_SIZE = 13

export const AUTOSAVE_INTERVAL_SECONDS = 30
export const BACKUP_INTERVAL_SECONDS = 3600

export const INTER_AGENT_HOST = '127.0.0.1'

/**
 * Named pipe do CLI no Windows (o macOS usa `run/agent.sock`).
 *
 * `net.Server.listen()` no Windows exige o caminho completo com o prefixo
 * `\\.\pipe\` — passar o nome curto devolve `EACCES`.
 */
export const CLI_PIPE_PATH = String.raw`\\.\pipe\omaestri-agent`

/** Nome curto, usado no texto da documentacao e no debug. */
export const CLI_PIPE_NAME = 'omaestri-agent'

export const AGENT_IDLE_TIMEOUT_MS = 2000
export const MAX_SCROLLBACK_LINES = 5000
