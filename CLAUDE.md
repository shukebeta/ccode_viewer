# Claude Code Viewer - Project-Specific Development Guidelines

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

## Ed Editor Tips for This Project

- Vue SFCs have three sections: `<template>`, `<script>`, `<style scoped>`
- When adding to methods object, remember the comma separator pattern
- Use `58s/}$/},/` to change last method's closing brace to include comma before adding new methods
