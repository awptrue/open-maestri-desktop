# open-maestri-desktop

[Português (Brasil)](README.pt-BR.md)

A spatial canvas for orchestrating AI agents. Version 1 targets **Windows 10 (x64)**.
Built with Electron and TypeScript, it reimplements [open-maestri](https://github.com/pedrotecinf/open-maestri), originally built for macOS with Swift and AppKit.

Run Claude Code, Codex, OpenCode, Gemini CLI, or a shell in real terminals on an infinite canvas.
Connect terminals to let agents communicate directly through the `omaestri` CLI.

## Project Status

Version 1 is in development. Release validation focuses on Windows 10 (x64).

| Milestone | Status |
| --- | --- |
| Canvas, PTY terminals, Markdown notes, file tree, workspace persistence, and `omaestri` CLI | Implemented |
| Portable build on Windows 10 | Build `7a93d44` passed smoke tests: CLI help, ConPTY, note access by full filename and short name, and clean workspace reopening |
| File tree and workspace recovery on Windows 10 | Portable build `7a93d44`: the file tree showed a newly created file without a reload. Reopening after an abrupt exit restored the last saved workspace. The recovery warning appeared only in the log and did not recur after a clean shutdown. |
| `omaestri ask` and `omaestri check` on Windows 10 | Portable build `7a93d44`: both commands passed end-to-end via the CLI shim between two connected PowerShell terminals running on ConPTY. Both rejected an unconnected terminal. No authenticated AI agent was tested because an authenticated QA profile was unavailable. |
| NSIS installer on Windows 10 | Build `7a93d44` passed silent per-user installation, a smoke test of the installed app, and uninstallation. Graphical installation and uninstallation also passed in per-user mode under an administrator account. A standard Windows account has not been tested. |
| Windows 10 display and notifications | Portable build `7a93d44` passed the minimum (900 x 600 DIP) and natively maximized window layout tests at 100% scaling. Both window sizes remain untested at native 125% scaling. The CLI accepted the notification request, but the on-screen banner has not been confirmed. |
| Windows 11 | Deferred until after v1; not validated |

## Requirements

- Windows 10 (x64)
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
