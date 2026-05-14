# Rewind

**Navigate and explore your AI coding sessions**

Browse, copy, and revisit your Claude Code & Copilot conversation history. Clean markdown copy, infinite scroll, and real-time session monitoring — everything the terminal can't give you.

## Project Structure

```
ccode_viewer/
├── server/          # Express API server for session data
└── viewer/          # Vue.js web interface
```

## Quick Start

### Install Dependencies

```bash
npm run install:all
```

### Development

Start both server and viewer:

```bash
npm run dev
```

Or start them separately:

```bash
# Terminal 1: Start server (port 6173)
npm run dev:server

# Terminal 2: Start viewer (port 6174)
npm run dev:viewer
```

Then open http://localhost:6174 in your browser.

## Frontend asset directory by environment

`server/launcher.js` only decides the static asset directory for the packaged-style app flow (`npm run start:app` and desktop packaging). The normal dev flow keeps using the Vite dev server from `viewer/`.

| Environment | How it starts | Frontend assets come from |
| --- | --- | --- |
| Web development | `npm run dev` or `npm run dev:viewer` | Vite serves the app directly from `viewer/` source files |
| Local packaged-style launch | `npm run start:app` after `npm run build:viewer` | `viewer/dist` |
| Windows EXE package | `pnpm run package:exe` output | `server/public` inside the packaged app payload |
| Tauri desktop package/dev host | `pnpm run package:tauri` or `pnpm run desktop:dev` | `server/public` inside the prepared desktop payload |
| Explicit override | Any launcher-based flow with `CCODE_VIEWER_PUBLIC_DIR=<path>` | The directory from `CCODE_VIEWER_PUBLIC_DIR` |

Launcher resolution order is:

1. `CCODE_VIEWER_PUBLIC_DIR`
2. `server/public`
3. `viewer/dist`
4. Fail during startup if the chosen directory still has no `index.html`

## Windows EXE packaging

The app can be packaged as a **single Windows EXE** that opens a native desktop window and renders the viewer inside an embedded **WebView2** control.

- The packaged EXE is a native Windows launcher with the app payload embedded inside it.
- On first launch of a given build, it copies the app into `%LOCALAPPDATA%\Rewind\builds\<build-id>`.
- It starts the bundled Node server as a child process and loads the viewer inside the desktop window.
- Closing the desktop window shuts down the child server process as well.
- It uses **one local port**, not separate 6173/6174 dev ports.
- At launch it scans for a free port starting at **6173** and falls back to the next available port automatically.
- Runtime logs are written under `%LOCALAPPDATA%\Rewind\run\<instance-id>\`, and the latest run directory is recorded in `%LOCALAPPDATA%\Rewind\run\latest-instance.txt`.
- The desktop window also includes a hover-only **Open in Browser** button in the top-right corner if you want to inspect the same local session in your normal browser.

### Local packaging

```bash
pnpm install
pnpm --dir server install
pnpm --dir viewer install
pnpm run package:exe
```

This produces:

```bash
dist/rewind-win-x64.exe
dist/BUILD-INFO.txt
```

When you run the EXE, the launcher expands the embedded app into LocalAppData, starts the server, opens the desktop host window, and loads the viewer there.

### GitHub Actions packaging

A manual workflow is included at:

```bash
.github/workflows/package-exe.yml
```

Run it with **Actions -> Package Windows EXE -> Run workflow**. It installs dependencies, runs the existing server tests, builds the frontend assets, publishes the native launcher EXE, and uploads the result as a workflow artifact.

## Tauri desktop packaging

The repository now also includes a **cross-platform Tauri desktop host** that keeps the existing packaged-app architecture:

- Tauri provides the native desktop window on Linux and Windows.
- The packaged app still runs the existing **Node/Express** backend and the built Vue frontend.
- A platform-native **Node sidecar** is bundled with the desktop app.
- On first launch of a build, the packaged payload is copied into the app-local data directory.
- The desktop host starts `server/launcher.js`, waits for the generated local URL, and opens it inside the desktop webview.
- Closing the desktop app shuts down the child Node process.

This path **does not remove or replace** the existing WinForms EXE packaging.

### Linux prerequisites

Tauri needs Rust plus native webview build dependencies. On Debian/MX Linux:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libglib2.0-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
```

Then restart your shell or run:

```bash
. "$HOME/.cargo/env"
```

### Local desktop build

```bash
pnpm install --frozen-lockfile
pnpm --dir server install --frozen-lockfile
pnpm --dir viewer install --frozen-lockfile
pnpm run package:tauri
```

The Tauri build first prepares `src-tauri/resources/app` with:

- the packaged server sources and production dependencies
- the shared helpers
- the production viewer build copied into `server/public`
- build metadata used by the desktop launcher

Typical outputs:

- **Linux**: `src-tauri/target/release/bundle/appimage/` and `src-tauri/target/release/bundle/deb/`
- **Windows**: `src-tauri/target/release/bundle/nsis/`

### Local desktop dev host

```bash
pnpm run desktop:dev
```

This uses the packaged desktop host flow, not the Vite dev server. It is intended for validating desktop packaging behavior rather than HMR-based frontend development.

### GitHub Actions packaging and releases

A tag-driven release workflow is included at:

```bash
.github/workflows/package-tauri.yml
```

When you push a version tag such as:

```bash
git tag v0.1.0
git push origin v0.1.0
```

the workflow builds and publishes a GitHub Release with downloadable assets for:

- Linux AppImage
- Linux `.deb`
- Windows Tauri installer
- Windows WinForms EXE
- macOS `.dmg`
- macOS `.app.zip`

The tag must match `package.json`'s version (for example, tag `v0.1.0` with `"version": "0.1.0"`), otherwise the release workflow fails fast.

For collaborators and users, the normal download location is:

- **GitHub -> Releases**

Actions artifacts still exist during a run, but they are temporary CI artifacts. Releases are the durable download surface.

Additional manual workflows are included for the other native targets:

- `.github/workflows/package-tauri-windows.yml`
- `.github/workflows/package-tauri-macos.yml`

These run on GitHub-hosted `windows-latest` and `macos-latest` runners and can be started manually from the Actions tab:

- **Package Windows Tauri App**
- **Package macOS Tauri App**

The repository now keeps:

- the existing manual Windows WinForms EXE workflow
- the automatic tag-based release workflow
- manual Windows Tauri and macOS Tauri workflows

If you later want Tauri-based Windows or macOS packaging in Actions, you can add either GitHub-hosted `windows-latest` / `macos-latest` jobs or self-hosted runners, depending on your signing and environment requirements.

## Architecture

### Server (Express API)

- **Port**: 6173
- **Purpose**: Provides REST API and SSE for session data
- **Key Features**:
  - Reads session files from `~/.claude/projects/*/sessions/*.jsonl`
  - Real-time file watching with SSE updates
  - Session mapping and parsing

### Viewer (Vue.js SPA)

- **Port**: 6174
- **Purpose**: Web interface for viewing sessions
- **Key Features**:
  - Two-column layout (user messages → assistant responses)
  - Real-time updates via EventSource
  - Markdown rendering with syntax highlighting
  - Special handlers for tools (TodoWrite, ExitPlanMode, thinking blocks)

### Packaged app

- **Port behavior**: dynamically selects an available local port starting at 6173
- **Purpose**: Runs the server and static frontend from a single EXE, hosted inside a desktop window for easy launch and shutdown

## Session Data Format

Sessions are stored in JSONL format at `~/.claude/projects/*/sessions/*.jsonl`, with each line representing a message:

```json
{"type":"user","message":{"content":"Hello"},"timestamp":"2025-10-09T12:00:00Z"}
{"type":"assistant","message":{"content":"Hi there!"},"timestamp":"2025-10-09T12:00:01Z"}
```

## Development

### Server Development

```bash
cd server
npm run dev    # Uses nodemon for auto-reload
```

### Viewer Development

```bash
cd viewer
npm run dev    # Vite dev server with HMR
```

### Testing

```bash
cd server
npm test
```

## License

MIT
