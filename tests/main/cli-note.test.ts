/**
 * Cobertura do comando `note` do roteador do CLI `omaestri`.
 *
 * O bug reproduzido no app empacotado: `omaestri list` imprime o `fileName`
 * literal (`Nota 1.md`), mas o comando so aceitava o nome curto (`Nota 1`).
 * O teste fixa os dois formatos, a insensibilidade a maiusculas e a
 * precedencia do arquivo literal quando existe colisao.
 *
 * Nada aqui importa `electron` nem abre janela: o store e um dublê que registra
 * chamadas de leitura/escrita.
 */

import { describe, expect, it } from 'vitest'

import type { PersistenceManager } from '../../src/main/persistence/persistence-manager'
import type { TerminalManager } from '../../src/main/terminal/terminal-manager'
import type { WorkspaceStore } from '../../src/main/workspace/workspace-store'
import { createRouter, type Router } from '../../src/main/ipc-server/router'

function makeRouter(
  files: Array<string | undefined>,
  contents: Record<string, string> = {},
): {
  router: Router
  reads: string[]
  writes: Array<{ workspaceId: string; fileName: string; content: string }>
} {
  const nodes = files.map((fileName, index) => ({
    id: `NOTE-${index}`,
    content: {
      type: 'stickyNote',
      value: fileName === undefined ? {} : { fileName },
    },
  }))
  const reads: string[] = []
  const writes: Array<{ workspaceId: string; fileName: string; content: string }> = []
  const store = {
    getActivePayload: () => ({
      id: 'WORKSPACE-1',
      nodes,
      connections: [],
      noteConnections: [],
    }),
    readNote: async (_workspaceId: string, fileName: string) => {
      reads.push(fileName)
      return contents[fileName] ?? ''
    },
    writeNote: async (workspaceId: string, fileName: string, content: string) => {
      writes.push({ workspaceId, fileName, content })
    },
  } as unknown as WorkspaceStore

  return {
    router: createRouter({
      store,
      terminals: {} as TerminalManager,
      persistence: {} as PersistenceManager,
    }),
    reads,
    writes,
  }
}

describe('note read — nome aceito', () => {
  it('aceita o nome literal impresso pelo list, com extensao', async () => {
    const { router, reads } = makeRouter(['Nota 1.md'], { 'Nota 1.md': '# Titulo' })

    expect(await router(['note', 'read', 'Nota 1.md'])).toBe('# Titulo')
    expect(reads).toEqual(['Nota 1.md'])
  })

  it('continua aceitando o nome curto, sem extensao', async () => {
    const { router, reads } = makeRouter(['Nota 1.md'], { 'Nota 1.md': 'conteudo' })

    expect(await router(['note', 'read', 'Nota 1'])).toBe('conteudo')
    expect(reads).toEqual(['Nota 1.md'])
  })

  it('aceita variacoes de maiusculas nos dois formatos', async () => {
    const { router, reads } = makeRouter(['Nota 1.md'], { 'Nota 1.md': 'texto' })

    expect(await router(['note', 'read', 'NOTA 1.MD'])).toBe('texto')
    expect(await router(['note', 'read', 'nota 1'])).toBe('texto')
    expect(reads).toEqual(['Nota 1.md', 'Nota 1.md'])
  })

  it('devolve (nota vazia) quando o arquivo nao tem conteudo', async () => {
    expect(await makeRouter(['Vazia.md']).router(['note', 'read', 'Vazia.md'])).toBe('(nota vazia)')
  })

  it('ignora no sem fileName e reporta nota inexistente', async () => {
    const { router } = makeRouter([undefined, 'Outra.md'])

    expect(await router(['note', 'read', 'Fantasma'])).toBe(
      "error: nota 'Fantasma' nao encontrada. Rode 'omaestri list'.",
    )
  })

  it('rejeita nome vazio sem tocar o store e mantem o arquivo literal .md', async () => {
    const { router, reads, writes } = makeRouter(['.md'], { '.md': 'literal' })

    expect(await router(['note', 'read', ''])).toBe(
      "error: nota '' nao encontrada. Rode 'omaestri list'.",
    )
    expect(await router(['note', 'write', '', 'x'])).toBe(
      "error: nota '' nao encontrada. Rode 'omaestri list'.",
    )
    expect(reads).toEqual([])
    expect(writes).toEqual([])

    // O nome literal ".md" continua valido: nada nele e vazio.
    expect(await router(['note', 'read', '.md'])).toBe('literal')
    expect(reads).toEqual(['.md'])
  })
})

describe('note write — grava no arquivo resolvido', () => {
  it('aceita o nome literal e informa o fileName gravado', async () => {
    const { router, writes } = makeRouter(['Nota 1.md'])

    expect(await router(['note', 'write', 'Nota 1.md', '# novo'])).toBe(
      "ok: nota 'Nota 1.md' gravada (6 bytes)",
    )
    expect(writes).toEqual([{ workspaceId: 'WORKSPACE-1', fileName: 'Nota 1.md', content: '# novo' }])
  })

  it('aceita o nome curto e grava no arquivo com extensao', async () => {
    const { router, writes } = makeRouter(['Nota 1.md'])

    await router(['note', 'write', 'nota 1', 'novo'])
    expect(writes).toHaveLength(1)
    expect(writes[0]?.fileName).toBe('Nota 1.md')
  })
})

describe('note edit — substitui trecho no arquivo resolvido', () => {
  it('aceita o nome curto e preserva o fileName literal na gravacao', async () => {
    const { router, writes } = makeRouter(['Nota 1.md'], { 'Nota 1.md': 'alpha beta' })

    expect(await router(['note', 'edit', 'nota 1', 'beta', 'BETA'])).toBe("ok: nota 'Nota 1.md' editada")
    expect(writes).toEqual([
      { workspaceId: 'WORKSPACE-1', fileName: 'Nota 1.md', content: 'alpha BETA' },
    ])
  })

  it('aceita o nome literal com extensao', async () => {
    const { router, writes } = makeRouter(['Nota 1.md'], { 'Nota 1.md': 'alpha beta' })

    expect(await router(['note', 'edit', 'Nota 1.md', 'beta', 'BETA'])).toBe(
      "ok: nota 'Nota 1.md' editada",
    )
    expect(writes).toEqual([
      { workspaceId: 'WORKSPACE-1', fileName: 'Nota 1.md', content: 'alpha BETA' },
    ])
  })

  it('reporta trecho ausente sem gravar', async () => {
    const { router, writes } = makeRouter(['Nota 1.md'], { 'Nota 1.md': 'alpha' })

    expect(await router(['note', 'edit', 'Nota 1.md', 'beta', 'BETA'])).toBe(
      "error: trecho nao encontrado em 'Nota 1.md'.",
    )
    expect(writes).toEqual([])
  })
})

describe('note — colisoes de nome', () => {
  it('da precedencia ao arquivo literal sobre o nome curto', async () => {
    // "Relatorio.md.md" tambem casa pelo nome curto "relatorio.md". O literal
    // "Relatorio.md" deve vencer mesmo estando depois na ordem dos nos.
    const { router, reads } = makeRouter(['Relatorio.md.md', 'Relatorio.md'], {
      'Relatorio.md.md': 'curto',
      'Relatorio.md': 'literal',
    })

    expect(await router(['note', 'read', 'relatorio.md'])).toBe('literal')
    expect(reads).toEqual(['Relatorio.md'])
  })

  it('prefere o literal com caixa identica ao nome informado', async () => {
    const { router, reads } = makeRouter(['A.md', 'a.md'], { 'A.md': 'maiuscula', 'a.md': 'minuscula' })

    expect(await router(['note', 'read', 'a.md'])).toBe('minuscula')
    expect(reads).toEqual(['a.md'])
  })

  it('desempata pelo primeiro no do workspace dentro do mesmo nivel', async () => {
    const { router, reads } = makeRouter(['A.md', 'a.md'], { 'A.md': 'primeira', 'a.md': 'segunda' })

    // "A" nao e literal de nenhum arquivo; os dois casam pelo nome curto e a
    // ordem dos nos decide, sem depender de ordenacao do sistema de arquivos.
    expect(await router(['note', 'read', 'A'])).toBe('primeira')
    expect(reads).toEqual(['A.md'])
  })
})
