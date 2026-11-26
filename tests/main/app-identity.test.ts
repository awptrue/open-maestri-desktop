/**
 * Identidade Windows do processo.
 *
 * O AUMID declarado em runtime precisa ser identico ao `build.appId` do
 * package.json: o NSIS do electron-builder grava esse mesmo valor nos atalhos
 * (`SetLnkAUMI`), e o toast so e aceito pelo Windows quando os dois coincidem.
 * O teste le o package.json real para impedir que os valores divirjam.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { WINDOWS_APP_USER_MODEL_ID } from '../../src/shared/constants'

interface PackageJsonBuild {
  build?: { appId?: string }
}

describe('identidade Windows', () => {
  it('AUMID explicito coincide com o build.appId usado nos atalhos do NSIS', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as PackageJsonBuild

    expect(pkg.build?.appId).toBe('dev.openmaestri.desktop')
    expect(WINDOWS_APP_USER_MODEL_ID).toBe(pkg.build?.appId)
  })
})
