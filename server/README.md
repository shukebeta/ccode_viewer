# Claude Code Viewer - Server

Express API server for accessing Claude Code CLI session data.

## Quick Start

```bash
cd server
npm install
npm start
```

Server will run on http://localhost:6173

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
