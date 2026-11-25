/**
 * Formato verbatim do fixture oficial do open-maestri (macOS).
 * Copiado de `Tests/OpenMaestriTests/Fixtures/TestWorkspace.json`.
 */
export const MACOS_MINIMAL_WORKSPACE = {
  schemaVersion: 2,
  type: 'workspace',
  payload: {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Test Workspace',
    nodes: [],
    connections: [],
    noteConnections: [],
    portalConnections: [],
    portalToPortalConnections: [],
    canvasOrigin: { x: 9800, y: 8500 },
    canvasZoom: 1.0,
    workingDirectory: '/tmp/test',
    createdAt: '2026-05-16T00:00:00Z',
    lastModifiedAt: '2026-05-16T00:00:00Z',
  },
} as const

/**
 * Nó terminal no formato Maestri v0.25.4 real: content envelopado em
 * `{ "terminal": { "_0": {...} } }`, frame como `[[x,y],[w,h]]`.
 */
export const MACOS_TERMINAL_NODE = {
  id: '00000000-0000-0000-0000-000000000001',
  frame: [
    [100.0, 200.0],
    [400.0, 300.0],
  ],
  content: {
    terminal: {
      _0: {
        agentType: 'claude_code',
        command: 'claude',
        name: 'Agent',
        icon: 'seal',
        color: '#007AFF',
        id: '00000000-0000-0000-0000-000000000002',
        shellPath: '/bin/zsh',
        workingDirectory: '/tmp',
        status: 'idle',
        isManager: false,
        monitorWithOmbro: false,
        autoScrollLocked: false,
        shortcutMode: { kind: 'automatic' },
        scrollbackLineCount: 0,
      },
    },
  },
  zIndex: 0,
  isLocked: false,
  createdAt: '2026-05-16T00:00:00Z',
  lastModifiedAt: '2026-05-16T00:00:00Z',
}

/** Workspace completo com todos os tipos de nó conectável. */
export const MACOS_FULL_WORKSPACE = {
  schemaVersion: 2,
  type: 'workspace',
  payload: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Full',
    icon: 'folder',
    isPinned: false,
    locationType: 'local',
    workingDirectory: '/Users/dev/project',
    preferredIDE: 'cursor',
    syncConfigFiles: false,
    canvasOrigin: [123, 456],
    canvasZoom: 0.75,
    nodes: [
      MACOS_TERMINAL_NODE,
      {
        id: '22222222-2222-4222-8222-222222222222',
        frame: [
          [600.0, 200.0],
          [260.0, 150.0],
        ],
        content: {
          stickyNote: {
            _0: {
              color: '#FEFDE8',
              fileName: 'Spec.md',
              fontSize: 14,
              hasCustomName: false,
              isPreviewing: false,
              storageMode: { managed: {} },
            },
          },
        },
        zIndex: 1,
        isLocked: false,
        createdAt: '2026-05-16T00:00:00Z',
        lastModifiedAt: '2026-05-16T00:00:00Z',
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        frame: [
          [900.0, 200.0],
          [500.0, 400.0],
        ],
        content: {
          portal: {
            _0: {
              id: '44444444-4444-4444-8444-444444444444',
              name: 'Docs',
              currentURL: 'https://example.com',
              source: { url: { _0: 'https://example.com' } },
              status: 'idle',
              chromeHidden: false,
              storageScope: 'isolated',
            },
          },
        },
        zIndex: 2,
        isLocked: false,
        createdAt: '2026-05-16T00:00:00Z',
        lastModifiedAt: '2026-05-16T00:00:00Z',
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        frame: [
          [100.0, 700.0],
          [300.0, 200.0],
        ],
        content: {
          fileTree: {
            _0: { name: 'Files', rootPath: '/Users/dev/project', viewMode: 'list' },
          },
        },
        zIndex: 3,
        isLocked: false,
        createdAt: '2026-05-16T00:00:00Z',
        lastModifiedAt: '2026-05-16T00:00:00Z',
      },
      {
        id: '66666666-6666-4666-8666-666666666666',
        frame: [
          [700.0, 700.0],
          [200.0, 80.0],
        ],
        content: {
          text: {
            _0: {
              text: 'Hello',
              fontSize: 18,
              fontWeight: 'regular',
              color: '#1a1a1a',
              alignment: 'left',
              fontFamily: 'sans',
            },
          },
        },
        zIndex: 4,
        isLocked: true,
        createdAt: '2026-05-16T00:00:00Z',
        lastModifiedAt: '2026-05-16T00:00:00Z',
      },
    ],
    connections: [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        createdAt: '2026-05-16T00:00:00Z',
        terminalIdA: '00000000-0000-0000-0000-000000000002',
        terminalIdB: '77777777-7777-4777-8777-777777777777',
        ropePoints: [
          [0, 0],
          [10, 10],
        ],
      },
    ],
    noteConnections: [
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        createdAt: '2026-05-16T00:00:00Z',
        terminalId: '00000000-0000-0000-0000-000000000002',
        noteNodeId: '22222222-2222-4222-8222-222222222222',
        ropePoints: [],
      },
    ],
    portalConnections: [
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        createdAt: '2026-05-16T00:00:00Z',
        terminalId: '00000000-0000-0000-0000-000000000002',
        portalNodeId: '33333333-3333-4333-8333-333333333333',
        ropePoints: [],
      },
    ],
    portalToPortalConnections: [],
    noteToNoteConnections: [],
    crossFloorConnections: [],
    floors: [],
    drawings: [],
    createdAt: '2026-05-16T00:00:00Z',
    lastOpenedAt: '2026-05-17T10:00:00Z',
    lastModifiedAt: '2026-05-17T10:00:00Z',
  },
} as const
