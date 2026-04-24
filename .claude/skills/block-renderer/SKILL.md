---
name: block-renderer
description: Add a new message block renderer for Rewind. Use when you discover a new message type (via visual-scan or user report) that shows as "Unknown block" or raw JSON. Covers the full pipeline: data normalization in fsHelpers, rendering in MessageRenderer, CSS styling, and verification. Trigger when the user says "add a renderer for X", "handle new block type", "unknown block found", or mentions a specific tool/message type that needs rendering.
---

# Block Renderer Development

Add a new message block renderer to Rewind. This skill covers the full data pipeline from raw JSON to rendered output.

## Architecture Overview

The rendering pipeline has three layers:

```
Raw JSONL (on disk)
  → fsHelpers.js: normalize and map messages
  → TwoColumnViewer.vue: organize into user/assistant pairs
  → MessageRenderer.vue: render content blocks to HTML
```

There are two session sources with different raw formats:

**Claude Code** (`source: 'claudecode'`):
- Content blocks in `message.content[]` array
- Each block: `{ type: 'tool_use', name: 'ToolName', input: {...} }` or `{ type: 'tool_result', ... }`
- `mapSessionMessages()` handles normalization (line 710 in fsHelpers.js)

**Copilot** (`source: 'gcopilot'`):
- Events: `assistant.message` (has `toolRequests[]`), `tool.execution_start/complete`
- `normalizeCopilotEvents()` handles normalization (line 650 in fsHelpers.js)
- Copilot tool names are mapped to Claude Code equivalents via `mapCopilotToolName()`

## Adding a New Renderer

### Step 1: Identify the source

Where does the unknown block come from?

- **Claude Code only**: The block has `{ type: 'tool_use', name: 'NewTool', input: {...} }`
- **Copilot only**: A copilot tool name not in `mapCopilotToolName()`
- **Both**: Need to handle in both normalization paths

### Step 2: If Copilot — add to normalization

In `fsHelpers.js`:

1. Add name mapping in `mapCopilotToolName()`:
```javascript
'new_tool': 'NewTool'  // copilot name → Claude Code name
```

2. Add input mapping in `mapCopilotToolInput()`:
```javascript
case 'new_tool':
  return { relevant_field: args.field || '' }
```

### Step 3: Add renderer in MessageRenderer.vue

Add a name-based check in `contentToHtml()`, after the existing tool checks (Bash, Read, Write, Grep) and before `if (t === 'image')`:

```javascript
if (c.name === 'NewTool' || (c.message && c.message.name === 'NewTool')) {
  const field = (c.input && c.input.relevant_field) || ''
  return `<div class="copilot-tool-label new-tool"><span class="tool-icon">&#x1F4CC;</span> NewTool: ${escapeHtml(field)}</div>`
}
```

Renderer patterns by complexity:

**Simple label** (most common):
```javascript
return `<div class="copilot-tool-label tool-class"><span class="tool-icon">ICON</span> Label: ${escapeHtml(value)}</div>`
```

**Collapsible details** (for large content like patches):
```javascript
return `<details class="detail-tool"><summary>${escapeHtml(summary)}</summary><pre><code>${escapeHtml(content)}</code></pre></details>`
```

**Badge list** (for subagents/tasks):
```javascript
const badges = ['Type'].map(b => `<span class="agent-result-badge">${escapeHtml(b)}</span>`).join('')
return `<div class="agent-result"><div class="agent-result-meta">${badges}</div></div>`
```

**Hidden** (for noise like report_intent):
```javascript
return ''  // completely hidden
```

### Step 4: Add CSS in styles.css

```css
.tool-class {
  border-left: 3px solid COLOR;
  background: BG_COLOR;
}
```

Put new styles after the existing tool renderer styles (around line 340+).

### Step 5: Verify with visual-scan skill

Run the Playwright scanner to confirm 0 unknown blocks. Take a screenshot to verify visual appearance.

## Existing Renderer Reference

| Name | File Location | Style |
|------|--------------|-------|
| Bash | MessageRenderer L596 | `.bash-tool` with `$` prompt |
| Read | renderReadTool L405 | `.read-summary` with file path |
| Write | renderWriteTool L444 | `.write-tool` with file path |
| Grep | renderGrepTool L384 | `.grep-tool` with pattern |
| Edit | MessageRenderer L607 | `.copilot-tool-label .edit-tool` |
| Glob | MessageRenderer L611 | `.copilot-tool-label .glob-tool` |
| WebSearch | MessageRenderer L617 | `.copilot-tool-label .web-search-tool` |
| Agent | MessageRenderer L627 | `.agent-result` with badges |
| Skill | MessageRenderer L639 | `.copilot-tool-label .skill-tool` |
| AskUserQuestion | MessageRenderer L621 | `.copilot-tool-label .ask-user-tool` with options |
| EnterPlanMode | MessageRenderer L643 | `.plan-mode-indicator` |
| ExitPlanMode | MessageRenderer L577 | custom markdown render |
| TaskCreate | MessageRenderer L647 | `.task-tool-label` |
| TaskUpdate | MessageRenderer L653 | `.task-tool-label` |
| TaskOutput | MessageRenderer L659 | `.task-tool-label` |
| TodoWrite | renderTodoWrite L372 | checkbox list |
| ApplyPatch | renderCopilotTool | `.apply-patch-tool` collapsible |
| SQL | renderCopilotTool | `.copilot-tool-label .sql-tool` |
| ReportIntent | renderCopilotTool | hidden (empty string) |

## Key Files

- `/home/davidw/Tools/ccode_viewer/server/fsHelpers.js` — data normalization (mapSessionMessages, normalizeCopilotEvents, mapCopilotToolName, mapCopilotToolInput)
- `/home/davidw/Tools/ccode_viewer/viewer/src/components/MessageRenderer.vue` — rendering (contentToHtml, renderCopilotTool, individual render functions)
- `/home/davidw/Tools/ccode_viewer/viewer/src/styles.css` — CSS styles for all tool renderers

## CSS Class Naming Convention

- Reusable tool labels: `.copilot-tool-label` base + specific class (e.g., `.edit-tool`)
- Specialized tools: custom class (e.g., `.agent-result`, `.bash-tool`)
- Color-coded left border to visually distinguish tool types
