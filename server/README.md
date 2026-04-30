# Rewind — Server

Express API server for accessing AI coding session data.

## Quick Start

```bash
cd server
npm install
npm start
```

Server will run on http://localhost:6173

## Launcher static asset resolution

`server.js` serves the API in normal development. `launcher.js` is the entry point for packaged-style runs such as `npm run start:app`, the Windows EXE, and the Tauri desktop host.

When `launcher.js` needs frontend files, it resolves them in this order:

1. `CCODE_VIEWER_PUBLIC_DIR` if set
2. `server/public` for packaged desktop payloads
3. `viewer/dist` for local repository builds created by `npm run build:viewer`

If none of those locations contains `index.html`, launch fails with a build-assets error instead of silently serving the wrong directory.

## What This Provides

- REST API for listing projects and sessions
- SSE (Server-Sent Events) for real-time session updates
- File watching for live session updates
- Session mapping and parsing from JSONL format

## API Endpoints

- `GET /api/projects` - List all projects
- `GET /api/sessions?project=<path>` - List sessions for a project
- `GET /api/session?file=<path>` - Read session JSONL file
- `GET /api/session-mapping?file=<path>` - Get mapped session data
- `GET /api/events?file=<path>` - SSE endpoint for live updates

## Development

```bash
npm run dev    # Uses nodemon for auto-reload
```

## Testing

```bash
npm test
```

## Data Source

Reads session files from `~/.claude/projects/*/sessions/*.jsonl`

## Security Notes

- This server reads files under the user's home directory
- Only bind to localhost (default: 127.0.0.1:6173)
- Do NOT expose this server publicly
