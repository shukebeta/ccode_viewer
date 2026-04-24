# Claude Code Viewer

A web-based viewer for Claude Code CLI sessions.

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

## Windows EXE packaging

The app can be packaged as a **single Windows EXE** that opens a native desktop window and renders the viewer inside an embedded **WebView2** control.

- The packaged EXE is a native Windows launcher with the app payload embedded inside it.
- On first launch of a given build, it copies the app into `%LOCALAPPDATA%\ClaudeCodeViewer\builds\<build-id>`.
- It starts the bundled Node server as a child process and loads the viewer inside the desktop window.
- Closing the desktop window shuts down the child server process as well.
- It uses **one local port**, not separate 6173/6174 dev ports.
- At launch it scans for a free port starting at **6173** and falls back to the next available port automatically.
- Runtime logs are written under `%LOCALAPPDATA%\ClaudeCodeViewer\run\<instance-id>\`, and the latest run directory is recorded in `%LOCALAPPDATA%\ClaudeCodeViewer\run\latest-instance.txt`.
- The desktop window also includes a hover-only **Open in Browser** button in the top-right corner if you want to inspect the same local session in your normal browser.

### Local packaging

```bash
npm install
npm --prefix server install
npm --prefix viewer install
npm run package:exe
```

This produces:

```bash
dist/ccode-viewer-win-x64.exe
dist/BUILD-INFO.txt
```

When you run the EXE, the launcher expands the embedded app into LocalAppData, starts the server, opens the desktop host window, and loads the viewer there.

### GitHub Actions packaging

A manual workflow is included at:

```bash
.github/workflows/package-exe.yml
```

Run it with **Actions -> Package Windows EXE -> Run workflow**. It installs dependencies, runs the existing server tests, builds the frontend assets, publishes the native launcher EXE, and uploads the result as a workflow artifact.

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
