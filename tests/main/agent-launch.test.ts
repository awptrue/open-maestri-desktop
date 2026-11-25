import { describe, expect, it, vi } from 'vitest'

import { buildLaunchInput } from '../../src/main/terminal/agent-launch'
import { TerminalSession } from '../../src/main/terminal/terminal-session'

describe('buildLaunchInput', () => {
  it.each(['', '   '])('nao prepara entrada para comando em branco (%j)', (command) => {
    expect(buildLaunchInput('pwsh', command)).toBeUndefined()
  })

  it.each(['pwsh', 'powershell', 'cmd'])('termina o comando com CR para %s', (shellLabel) => {
    expect(buildLaunchInput(shellLabel, 'claude')).toBe('claude\r')
  })

  it('preserva aspas e espacos do comando', () => {
    expect(buildLaunchInput('pwsh', 'claude --prompt "dois termos"')).toBe('claude --prompt "dois termos"\r')
  })
})

describe('TerminalSession', () => {
  it.runIf(process.platform === 'win32')('executa o comando no PTY real do cmd.exe', async () => {
    const session = await TerminalSession.create({
      id: 'AE90AAAE-F4A1-4BA8-9F0D-BEDF6F079098',
      name: 'Agent Launch',
      agentType: 'generic_shell',
      shellPath: 'cmd.exe',
      command: 'echo MARCADOR',
      workingDirectory: process.cwd(),
      cols: 120,
      rows: 24,
      env: process.env,
    })

    try {
      await vi.waitFor(() => {
        expect(session.bufferLines().filter((line) => line.trim() === 'MARCADOR')).toHaveLength(1)
      }, { timeout: 5000 })
    } finally {
      session.kill()
    }
  })
})
