# Claude Code Viewer - Project-Specific Development Guidelines

A web-based viewer for browsing and searching Claude Code session history.

## Project Structure

```
ccode_viewer/
├── server/                    # Backend (Express.js)
│   ├── server.js              # API endpoints
│   ├── fsHelpers.js           # Session file operations (core logic)
│   └── __tests__/             # Jest tests
├── viewer/                    # Frontend (Vue 3 + Vite)
│   └── src/
│       ├── App.vue            # Main app container
│       ├── main.js            # Vue app entry
│       ├── styles.css         # Global styles (IMPORTANT!)
│       └── components/
│           ├── Projects.vue       # Project list sidebar
│           ├── Sessions.vue       # Session list for selected project
│           ├── TwoColumnViewer.vue # Main message viewer
│           ├── MessageRenderer.vue # Renders individual messages
│           ├── CodeBlock.vue      # Syntax-highlighted code blocks
│           ├── SearchBox.vue      # Search input component
│           └── SearchResults.vue  # Search results display
└── package.json               # Root scripts for dev/build
```

## Key Concepts

### Session Types
- **Main sessions**: UUID-named files (e.g., `1e6d31a2-8651-42ab-8f2f-d26321d4ea29.jsonl`)
- **Agent sessions**: Subagent task files (e.g., `agent-1204ee53.jsonl`)
- Sessions with < 3 messages are filtered out (warmup/empty sessions)

### Session Data Location
- Windows: `C:\Users\<user>\.claude\projects\`
- Each project folder contains `.jsonl` session files
- Project folder names use `--` as path separators (e.g., `D--git-myproject`)

## Core Backend Functions (fsHelpers.js)

### `getSessions(projectName)` (line ~234)
- Reads all `.jsonl` files in project directory
- Returns session metadata: id, filePath, startTime, messageCount, preview, isAgent
- Filters out sessions with messageCount < 3
- Sorted by modification time (newest first)

### `readSessionFile(filePath)` (line ~323)
- Parses JSONL file into array of message objects

### `searchInProject(projectId, keyword)` (line ~506)
- Full-text search across all sessions in a project
- Returns matching user messages with assistant replies
- Limited to 100 sessions, 200 results

### `mapSessionMessages(filePath)` (line ~400+)
- Maps user messages to their assistant replies
- Used by search and viewer components

## UI Components - Element Plus

**CRITICAL: Never use native browser dialogs**

This project uses **Element Plus** as the UI component library. Always use modern components instead of 90s-style browser natives:

❌ **FORBIDDEN:**
- `alert()` - use `ElMessage` or `ElNotification`
- `confirm()` - use `ElMessageBox.confirm()`
- `prompt()` - use `ElMessageBox.prompt()`

✅ **CORRECT:**
```javascript
// Import at top of <script>
import { ElMessageBox, ElMessage } from 'element-plus'

// Show confirmation
await ElMessageBox.confirm('Delete this item?', 'Confirm', {
  confirmButtonText: 'Delete',
  cancelButtonText: 'Cancel',
  type: 'warning'
})

// Show error message
ElMessage.error('Operation failed')

// Show success message
ElMessage.success('Saved successfully')
```

**Common Element Plus components:**
- Dialogs: `ElDialog`, `ElMessageBox`
- Messages: `ElMessage`, `ElNotification`
- Forms: `ElForm`, `ElInput`, `ElSelect`, `ElDatePicker`
- Tables: `ElTable`
- Buttons: `ElButton`

Documentation: https://element-plus.org/

## Vue.js Component Styling

**CRITICAL: Always use global CSS for dynamically rendered elements**

- Vue's `<style scoped>` only works reliably for static template elements
- For any dynamic content (v-if, v-for, programmatically added elements), put styles in `/viewer/src/styles.css`
- Global style file is imported in `/viewer/src/main.js`

Example:
```vue
<!-- BAD: Scoped styles for v-if elements may not work -->
<template>
  <button v-if="condition" class="delete-btn">×</button>
</template>
<style scoped>
.delete-btn { /* ... */ }
</style>

<!-- GOOD: Put in /viewer/src/styles.css -->
```

## Project Architecture

### Backend (server/)
- `server.js` - Express API endpoints
- `fsHelpers.js` - File system operations for Claude sessions
- Session files location: `~/.claude/projects/`

### Frontend (viewer/)
- Vue 3 SFC components in `/viewer/src/components/`
- Global styles: `/viewer/src/styles.css`
- Theme styles: `/viewer/src/styles/ui-light.css`

## Date/Time Handling

Session timestamps use ISO 8601 format. To check if a session is from today:

```javascript
isToday(ts) {
  const d = new Date(ts)
  const today = new Date()
  return d.getFullYear() === today.getFullYear() &&
         d.getMonth() === today.getMonth() &&
         d.getDate() === today.getDate()
}
```

## API Patterns

Follow existing patterns in `server.js`:
- GET endpoints for read operations
- DELETE endpoints for deletion (use query params for file paths)
- Always validate required query params
- Return JSON with `{ error: 'message' }` for errors

## Development Commands

```bash
# Development (runs both backend and frontend)
npm run dev

# Build frontend for production
npm run build

# Run tests
npm test
```

## API Endpoints (server.js)

- `GET /api/projects` - List all projects
- `GET /api/sessions?project=<id>` - List sessions for a project
- `GET /api/session?file=<path>` - Read session messages
- `DELETE /api/session?file=<path>` - Delete a session file
- `GET /api/search?project=<id>&q=<keyword>` - Search within project

## Session Object Shape

```javascript
{
  id: string,           // Session ID (from filename or first line)
  projectPath: string,  // Full path to project directory
  filePath: string,     // Full path to .jsonl file
  startTime: string,    // ISO 8601 timestamp
  endTime: string,      // ISO 8601 timestamp
  mtime: Date,          // File modification time
  messageCount: number, // Total user + assistant messages
  totalCost: number,    // Sum of costUSD fields
  preview: string,      // First ~200 chars of recent messages
  isAgent: boolean      // true if filename starts with "agent-"
}
```

## Common Patterns

### Adding new session metadata
1. Add field extraction in `getSessions()` loop (fsHelpers.js ~245-308)
2. Include in session object (fsHelpers.js ~297-308)
3. Use in frontend component (Sessions.vue)

### Adding new styles for dynamic elements
Always add to `/viewer/src/styles.css`, NOT in `<style scoped>`
