# open-maestri-desktop

[Português (Brasil)](README.pt-BR.md)

A spatial canvas for orchestrating AI agents on **Windows 10/11 (x64)**.
Built with Electron and TypeScript, it reimplements [open-maestri](https://github.com/pedrotecinf/open-maestri), originally built for macOS with Swift and AppKit.

Run Claude Code, Codex, OpenCode, Gemini CLI, or a shell in real terminals on an infinite canvas.
Connect terminals to let agents communicate directly through the `omaestri` CLI.

## Project Status

Version 1 is in development. The canvas, PTY-backed terminals, Markdown notes, file tree,
workspace persistence, and `omaestri` CLI are implemented. Running the installer and portable
build on both Windows versions remains part of release validation.

## Requirements

- Windows 10 or Windows 11, x64
- Node.js 22.12 or later
- No C++ build tools required: the PTY uses prebuilt ConPTY binaries.

## Development

```powershell
npm install
npm run dev          # Electron with hot reload
npm run typecheck    # Type-check the Node.js and renderer projects
npm test             # Run Vitest
npm run build        # Type-check and build for production
npm run package      # Build the NSIS installer and portable executable in dist/
```

## macOS Compatibility

The Windows app uses the same workspace data layout as the macOS app:

```
%USERPROFILE%\.open-maestri\
├── manifest.json               # workspace index (schemaVersion 1)
├── preferences.json
├── app-state.json              # activeWorkspaceId + cleanShutdown
└── workspaces\{UUID}\
    ├── workspace.json          # schemaVersion 2: nodes and connections
    ├── notes\{name}.md
    └── terminals\{UUID}.scrollback
```

See [the compatibility guide](docs/compatibility.md) for the file format and migration details.

### Platform Differences

| Item | macOS | Windows |
|------|-------|---------|
| CLI transport | Unix socket + TCP | Named pipe `\\.\pipe\omaestri-agent` + loopback TCP |
| Paths in JSON | POSIX (`/Users/...`) | Written in POSIX form and converted when read |
| Shell | `zsh`/`bash` | PowerShell, `cmd`, Git Bash (`shell-resolver.ts`) |
| Portal | WKWebView | Electron `WebContentsView` |
| Ombro | Apple Foundation Models | No equivalent; out of scope |

## Documentation

- [Architecture](docs/architecture.md): system design, data flow, and modules
- [Compatibility](docs/compatibility.md): on-disk format
- [CLI protocol](docs/cli-protocol.md): `omaestri` command protocol

## License

GPL-3.0-or-later. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
