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
