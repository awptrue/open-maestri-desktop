import { createLogger } from '../logger'

const log = createLogger('AgentLaunch')

function ignoreLaunch(reason: string): undefined {
  try {
    log.warn(reason)
  } catch {
    return undefined
  }
  return undefined
}

export function buildLaunchInput(shellLabel: string | undefined, command?: string): string | undefined {
  if (command === undefined) return undefined
  if (typeof command !== 'string') return ignoreLaunch('Comando de agente invalido')
  if (command.trim() === '') return undefined
  if (/[\x00-\x1f\x7f]/.test(command)) {
    return ignoreLaunch('Comando de agente contem caracteres de controle')
  }

  const label = typeof shellLabel === 'string' ? shellLabel.trim().toLowerCase() : undefined
  if (label !== 'pwsh' && label !== 'powershell' && label !== 'cmd') {
    return ignoreLaunch('Shell sem suporte a disparo de comando de agente')
  }

  return `${command}\r`
}
