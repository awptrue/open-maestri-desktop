/**
 * Janela principal.
 *
 * Seguranca: `contextIsolation` ligado, `nodeIntegration` desligado, `sandbox`
 * desligado apenas porque o preload precisa de IPC livre. Navegacao externa e
 * `window.open` sao bloqueados; so https abre no navegador do sistema.
 */

import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

import { createLogger } from './logger'

const log = createLogger('Window')

let mainWindow: BrowserWindow | undefined

export function getMainWindow(): BrowserWindow | undefined {
  return mainWindow
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#111113',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false,
      preload: join(import.meta.dirname, '../preload/index.cjs'),
    },
  })

  win.on('ready-to-show', () => {
    win.show()
    log.info('janela pronta')
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined
  })

  // Nunca abrir link externo dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Navegacao para fora do app e bloqueada; o renderer usa wv/portal proprio.
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl && url.startsWith(devUrl)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
    if (url.startsWith('https://')) void shell.openExternal(url)
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void win.loadURL(rendererUrl)
    log.info(`carregando renderer de ${rendererUrl}`)
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
    log.info('carregando renderer de arquivo')
  }

  mainWindow = win
  return win
}
