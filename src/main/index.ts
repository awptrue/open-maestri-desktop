/**
 * Bootstrap do processo principal — equivalente a
 * `AppDelegate.applicationDidFinishLaunching` no original.
 *
 * A ORDEM E IMUTAVEL (ver docs/architecture.md):
 *   1. Servidor CLI sobe ANTES da janela. Um terminal restaurado precisa
 *      encontrar o pipe escutando, senao `omaestri` falha nos primeiros segundos.
 *   2. Instalacao dos shims do CLI (idempotente, todo boot).
 *   3. Estado persistido (manifest, preferencias, app-state) + deteccao de crash.
 *   4. Janela.
 */

import { app, dialog } from 'electron'

import { AUTOSAVE_INTERVAL_SECONDS } from '@shared/constants'
import { IPC } from '@shared/ipc-channels'
import { registerIpcBridge } from './ipc-bridge'
import { installSkills } from './connection/skill-injector'
import { closeAllDirectoryWatchers } from './filetree/file-tree'
import { describeError, createLogger, configureLogFile } from './logger'
import { interAgentServer } from './ipc-server/server'
import { installCli } from './ipc-server/cli-install'
import { installRouter } from './ipc-server/router'
import { createPaths, resolveRoot } from './paths'
import { PersistenceManager } from './persistence/persistence-manager'
import { createBackup, startBackupScheduler } from './persistence/backup'
import { terminalManager } from './terminal/terminal-manager'
import { WorkspaceStore } from './workspace/workspace-store'
import { createMainWindow, getMainWindow } from './window'

const log = createLogger('Main')

configureLogFile(resolveRoot())

let shuttingDown = false
/**
 * Falso ate a gravacao final terminar. `before-quit` NAO espera promessas: sem
 * o `preventDefault` abaixo, o processo morre no meio do `workspaceStore.shutdown()`
 * e todo fechamento normal vira "shutdown anterior nao foi limpo" no boot seguinte.
 */
let shutdownComplete = false
const SHUTDOWN_TIMEOUT_MS = 5000
const paths = createPaths()
const persistence = new PersistenceManager(paths)
const workspaceStore = new WorkspaceStore(persistence, terminalManager, AUTOSAVE_INTERVAL_SECONDS * 1000)
let backups: ReturnType<typeof startBackupScheduler> | undefined

if (!app.requestSingleInstanceLock()) {
  // Dois processos brigariam pelo mesmo named pipe e pelos mesmos arquivos.
  log.warn('outra instancia ja esta rodando — encerrando esta')
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(bootstrap).catch((e: unknown) => {
    log.error(`bootstrap falhou: ${describeError(e)}`)
    dialog.showErrorBox('open-maestri', `Falha ao iniciar:\n${describeError(e)}`)
    app.quit()
  })
}

async function bootstrap(): Promise<void> {
  log.info(`open-maestri ${app.getVersion()} iniciando (${process.platform}/${process.arch})`)
  log.info(`diretorio de dados: ${paths.root}`)

  // 1. Servidor CLI primeiro. Falha aqui nao impede o app de abrir.
  installRouter({
    store: workspaceStore,
    terminals: terminalManager,
    persistence,
  })
  try {
    await interAgentServer.start()
  } catch (e) {
    log.error(`servidor CLI nao subiu: ${describeError(e)}`)
  }

  if (interAgentServer.port > 0) {
    // O env das sessoes PTY precisa da porta: sem ela o CLI de dentro do
    // terminal so teria o named pipe como caminho.
    terminalManager.setHttpPort(interAgentServer.port)
  }

  if (interAgentServer.pipeUnavailable) {
    log.error('named pipe ocupado — o CLI apontara para a outra instancia')
  }

  // 2. Shims do CLI + skills dos agentes. Um erro aqui nao pode derrubar o boot:
  //    o app abre e o usuario continua podendo trabalhar.
  try {
    const cli = await installCli()
    terminalManager.setCliDir(cli.cliDir)
    log.info(`shims do CLI em ${cli.cliDir}${cli.changed ? ' (atualizados)' : ''}`)
    if (cli.posixShimWarning) log.info(cli.posixShimWarning)
  } catch (e) {
    log.error(`shims do CLI nao instalados: ${describeError(e)}`)
  }

  try {
    const preferences = await persistence.loadPreferences()
    const skills = await installSkills(preferences)
    const written = skills.filter((skill) => skill.status === 'installed' || skill.status === 'updated')
    log.info(`skills: ${written.length} gravada(s), ${skills.length} destino(s)`)
  } catch (e) {
    log.error(`skills nao instaladas: ${describeError(e)}`)
  }

  // 3. Estado persistido. Um workspace corrompido vai para quarentena e o app
  //    abre mesmo assim — nunca travar o boot por disco.
  try {
    await workspaceStore.load()
  } catch (e) {
    log.error(`estado persistido nao carregou: ${describeError(e)}`)
  }

  if (workspaceStore.needsRecovery) {
    // Nao interromper o usuario com modal: o autosave de 30s limita a perda, e
    // o backup horario cobre o resto. Registra para o diagnostico e segue.
    log.warn('shutdown anterior nao foi limpo — dados podem estar 30s desatualizados')
  }

  backups = startBackupScheduler(paths)

  // 4. Bridge IPC e janela.
  registerIpcBridge({
    store: workspaceStore,
    terminals: terminalManager,
    scrollbackPath: (workspaceId, terminalId) => paths.scrollbackFile(workspaceId, terminalId),
  })
  const win = createMainWindow()

  app.on('activate', () => {
    if (getMainWindow() === undefined) createMainWindow()
  })

  win.on('closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  log.info('bootstrap concluido')
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (shutdownComplete) return
  event.preventDefault()
  if (shuttingDown) return
  shuttingDown = true
  log.info('encerrando')
  // Ordem: PTYs primeiro (senao eles escrevem num named pipe ja fechado),
  // depois o estado, por ultimo o servidor e os watchers.
  terminalManager.destroyAll()
  backups?.stop()
  void (async () => {
    // Disco travado ou pipe pendurado nao podem impedir o app de fechar.
    const watchdog = setTimeout(() => {
      log.error('shutdown demorou mais de 5s — saindo sem concluir a gravacao')
      shutdownComplete = true
      app.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)

    try {
      await workspaceStore.shutdown().catch((e: unknown) => {
        log.error(`falha ao gravar estado no shutdown: ${describeError(e)}`)
      })
      // Backup no encerramento limpo: o horario sozinho pode nunca cobrir uma
      // sessao curta de trabalho.
      await createBackup(paths).catch(() => undefined)
      // Watchers seguram handle do sistema: fechar evita processo pendurado.
      await closeAllDirectoryWatchers().catch((e: unknown) => {
        log.warn(`falha ao fechar watchers: ${describeError(e)}`)
      })
      await interAgentServer.stop()
    } finally {
      clearTimeout(watchdog)
      shutdownComplete = true
      // Reemite before-quit; agora o guard acima deixa passar.
      app.quit()
    }
  })()
})

// Erros nao tratados nunca podem morrer em silencio.
process.on('uncaughtException', (e) => {
  log.error(`uncaughtException: ${describeError(e)}`)
})
process.on('unhandledRejection', (e) => {
  log.error(`unhandledRejection: ${describeError(e)}`)
})

export { IPC }
