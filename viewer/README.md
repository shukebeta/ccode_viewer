# Claude Code Viewer - Web Interface

Vue.js web interface for viewing Claude Code CLI sessions.

## Quick Start

```bash
cd viewer
npm install
npm run dev
```

Viewer will run on http://localhost:6174

## Features

- Two-column layout (user messages → assistant responses)
- Real-time updates via Server-Sent Events
- Markdown rendering with syntax highlighting
- Special renderers for:
  - TodoWrite (task lists)
  - ExitPlanMode (plan summaries)
  - Thinking blocks
  - Code blocks with copy functionality
  - Tool invocations (Read, Bash, etc.)

## Architecture

The viewer connects to the API server (default: http://localhost:6173) via:
- REST API calls for initial data
- EventSource for real-time updates

Proxy configuration in `vite.config.js`:
```javascript
proxy: {
  '/api': 'http://localhost:6173'
}
```

## Development

```bash
npm run dev      # Start dev server with HMR
npm run build    # Build for production
npm run preview  # Preview production build
```

## Component Structure

- `App.vue` - Main app shell
- `Projects.vue` - Project list view
- `Sessions.vue` - Session list view
- `TwoColumnViewer.vue` - Main session viewer
- `MessageRenderer.vue` - Message content renderer
- `CodeBlock.vue` - Syntax-highlighted code blocks
