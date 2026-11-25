/**
 * Tema do xterm, alinhado as cores do canvas (`styles.css`).
 * Fundo igual ao `--bg-node` para o no nao parecer um retangulo colado.
 */

import type { ITheme } from '@xterm/xterm'

export const TERMINAL_THEME: ITheme = {
  background: '#1d1d21',
  foreground: '#e8e8ea',
  cursor: '#3f8cff',
  cursorAccent: '#1d1d21',
  selectionBackground: 'rgba(63, 140, 255, 0.35)',
  black: '#1d1d21',
  red: '#ff6b6b',
  green: '#51cf66',
  yellow: '#fcc419',
  blue: '#4dabf7',
  magenta: '#da77f2',
  cyan: '#3bc9db',
  white: '#e8e8ea',
  brightBlack: '#8b8b93',
  brightRed: '#ff8787',
  brightGreen: '#69db7c',
  brightYellow: '#ffe066',
  brightBlue: '#74c0fc',
  brightMagenta: '#e599f7',
  brightCyan: '#66d9e8',
  brightWhite: '#ffffff',
}
