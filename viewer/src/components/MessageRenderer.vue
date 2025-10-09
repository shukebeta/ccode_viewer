<template>
  <div class="message-renderer">
  <button v-if="rawJson && showRawCopy" class="copy-json" @click="copyRaw" :title="copied ? 'Copied' : 'Copy original JSON'">
      ⧉
      <span v-if="copied" class="copied-label">Copied</span>
    </button>
    <div v-if="isTodoWrite" class="todo-container">
      <div class="todo-list" v-html="todoHtml"></div>
      <div v-if="systemNote" class="system-note" v-html="escapeHtml(systemNote)"></div>
    </div>
    <div v-else v-html="html"></div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, nextTick, createApp } from 'vue'
import { marked } from 'marked'

const props = defineProps({ content: { type: [Object, Array, String], required: true }, showRawCopy: { type: Boolean, default: true } })
const emit = defineEmits([])


function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderPlain(c) {
  if (typeof c === 'string') return escapeHtml(c)
  if (Array.isArray(c)) return c.map(renderPlain).join('<br/>')
  if (c && typeof c === 'object') return escapeHtml(c.text || JSON.stringify(c))
  return ''
}

function renderCode(c) {
  const code = (c && (c.code || c.text)) || ''
  const str = String(code || '')
  // if long, wrap in collapsed container
  const lines = str.split('\n').length
  const mustCollapse = lines > 6 || str.length > 400
  const escaped = escapeHtml(str)
  if (!mustCollapse) return `<div class="__code_placeholder" data-lang="${escapeHtml('')}" data-raw="${escapeHtml(str)}"></div>`
  const preStyle = 'max-height:3.6em;overflow:hidden;transition:max-height 0.18s ease'
  const btnStyle = 'display:inline-block;margin-top:6px;background:transparent;border:none;color:#0a66ff;cursor:pointer;padding:2px 6px;font-size:13px'
  return `<div class="read-container"><div class="__code_placeholder" data-lang="${escapeHtml('')}" data-raw="${escapeHtml(str)}" style="max-height:3.6em;overflow:hidden"></div><div style="display:flex;gap:8px;margin-top:6px"><button class="read-toggle" data-full="false" style="${btnStyle}">Show more</button><button class="copy-code-btn" style="${btnStyle}">Copy</button></div></div>`
}

function renderToolResult(c) {
  const v = c && (c.content || c.text) || ''
  if (!v) return ''
  // if looks like JSON
  try {
    const parsed = JSON.parse(v)
    const pretty = escapeHtml(JSON.stringify(parsed, null, 2))
    const str = pretty
    const lines = str.split('\n').length
    const mustCollapse = lines > 6 || str.length > 400
  if (!mustCollapse) return `<div class="__code_placeholder" data-lang="json" data-raw="${escapeHtml(JSON.stringify(parsed, null, 2))}"></div>`
  const preStyle = 'max-height:3.6em;overflow:hidden;transition:max-height 0.18s ease'
  const btnStyle = 'display:inline-block;margin-top:6px;background:transparent;border:none;color:#0a66ff;cursor:pointer;padding:2px 6px;font-size:13px'
  return `<div class="read-container"><div class="__code_placeholder" data-lang="json" data-raw="${escapeHtml(JSON.stringify(parsed, null, 2))}" style="max-height:3.6em;overflow:hidden"></div><div style="display:flex;gap:8px;margin-top:6px"><button class="read-toggle" data-full="false" style="${btnStyle}">Show more</button><button class="copy-code-btn" style="${btnStyle}">Copy</button></div></div>`
  } catch (e) {
    // fallback: if it looks like code prefer a code block, else render as markdown (but escape HTML first)
    const str = String(v)
    const escaped = escapeHtml(str)
    const lines = str.split('\n').length
    const mustCollapse = lines > 6 || str.length > 400
    if (isCodeLike(str)) {
  if (!mustCollapse) return `<div class="__code_placeholder" data-lang="" data-raw="${escapeHtml(str)}"></div>`
  const preStyle = 'max-height:3.6em;overflow:hidden;transition:max-height 0.18s ease'
  const btnStyle = 'display:inline-block;margin-top:6px;background:transparent;border:none;color:#0a66ff;cursor:pointer;padding:2px 6px;font-size:13px'
  return `<div class="read-container"><div class="__code_placeholder" data-lang="" data-raw="${escapeHtml(str)}" style="max-height:3.6em;overflow:hidden"></div><div style="display:flex;gap:8px;margin-top:6px"><button class="read-toggle" data-full="false" style="${btnStyle}">Show more</button><button class="copy-code-btn" style="${btnStyle}">Copy</button></div></div>`
    }
    if (str.includes('\n') || /\[[ x\-]\]|#{1,6} /m.test(str)) {
      // if markdown-like, render full markdown but still collapse if long
      const rendered = marked.parse(escaped)
  if (!mustCollapse) return `<div class="tool-result">${rendered}</div>`
  const preStyle = 'max-height:3.6em;overflow:hidden;transition:max-height 0.18s ease'
  const btnStyle = 'display:inline-block;margin-top:6px;background:transparent;border:none;color:#0a66ff;cursor:pointer;padding:2px 6px;font-size:13px'
  return `<div class="read-container"><div class="tool-result read-collapsed" style="${preStyle}">${rendered}</div><div style="display:flex;gap:8px;margin-top:6px"><button class="read-toggle" data-full="false" style="${btnStyle}">Show more</button><button class="copy-code-btn" style="${btnStyle}">Copy</button></div></div>`
    }
  if (!mustCollapse) return `<pre class="tool-result">${escaped}</pre>`
  const preStyle = 'max-height:3.6em;overflow:hidden;transition:max-height 0.18s ease'
  const btnStyle = 'display:inline-block;margin-top:6px;background:transparent;border:none;color:#0a66ff;cursor:pointer;padding:2px 6px;font-size:13px'
  return `<div class="read-container"><pre class="tool-result read-collapsed" style="${preStyle}">${escaped}</pre><div style="display:flex;gap:8px;margin-top:6px"><button class="read-toggle" data-full="false" style="${btnStyle}">Show more</button><button class="copy-code-btn" style="${btnStyle}">Copy</button></div></div>`
  }
}

function renderJson(c) {
  try {
    const obj = c && (c.value || c.content) || c
    return `<pre class="json-content">${escapeHtml(JSON.stringify(obj, null, 2))}</pre>`
  } catch (e) { return `<pre class="json-content">${escapeHtml(String(c))}</pre>` }
}

function renderImage(c) {
  const src = c && (c.url || c.src || c.content) || ''
  return `<div class="image-content"><img src="${escapeHtml(src)}" alt="image"/></div>`
}

function renderMarkdown(c) {
  const src = (c && (c.text || c.content)) || ''
  // escape raw HTML before parsing markdown to avoid accidental tag promotion
  return marked.parse(escapeHtml(String(src)))
}

// Shared custom markdown renderer with inline styles (for ExitPlanMode and thinking blocks)
function createCustomMarkdownRenderer() {
  const renderer = new marked.Renderer()
  
  renderer.heading = (text, level) => {
    const sizes = ['1.5em', '1.3em', '1.1em']
    const size = sizes[level - 1] || '1em'
    return `<h${level} style="margin:0.5rem 0;font-size:${size};font-weight:600">${text}</h${level}>\n`
  }
  
  renderer.paragraph = (text) => {
    return `<p style="margin:0.3rem 0;line-height:1.5">${text}</p>\n`
  }
  
  renderer.list = (body, ordered) => {
    const tag = ordered ? 'ol' : 'ul'
    return `<${tag} style="margin:0.3rem 0;padding-left:1.5rem">${body}</${tag}>\n`
  }
  
  renderer.listitem = (text) => {
    return `<li style="margin:0.2rem 0">${text}</li>\n`
  }
  
  renderer.hr = () => {
    return `<hr style="margin:0.5rem 0;border:none;border-top:1px solid rgba(0,0,0,0.1)">\n`
  }
  
  renderer.codespan = (code) => {
    return `<code style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,'Courier New',monospace;font-size:0.9em">${code}</code>`
  }
  
  renderer.code = (code, language) => {
    return `<pre style="margin:0.4rem 0;background:rgba(0,0,0,0.05);padding:8px;border-radius:4px"><code style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,'Courier New',monospace;font-size:0.9em">${code}</code></pre>\n`
  }
  
  return renderer
}

function renderTodoWrite(c) {
  // Expecting structure like: { input: { todos: [ { id, content, status } ] } }
  const todos = (c && c.input && c.input.todos) || (c && c.todos) || null
  if (!Array.isArray(todos)) return ''
  const lines = todos.map(t => {
    const status = (t.status || '').toLowerCase()
    const marker = status === 'completed' || status === 'done' || status === 'x' ? '[x]' : (status === 'in_progress' || status === 'doing' || status === 'doing' ? '[-]' : '[ ]')
    return `${marker} ${String(t.content || t.text || t.title || '').trim()}`
  })
  return marked.parse(lines.join('\n'))
}

function renderReadTool(c) {
  // Expecting structure like: { input: { path, content } } or { result: { content } }
  // Prefer to show a concise one-line summary when file path is available
  const pathCandidates = []
  if (c && c.input) {
    if (c.input.path) pathCandidates.push(c.input.path)
    if (c.input.file_path) pathCandidates.push(c.input.file_path)
    if (c.input.filePath) pathCandidates.push(c.input.filePath)
  }
  if (c && c.result) {
    if (c.result.path) pathCandidates.push(c.result.path)
    if (c.result.file_path) pathCandidates.push(c.result.file_path)
    if (c.result.filePath) pathCandidates.push(c.result.filePath)
  }
  if (c && c.file_path) pathCandidates.push(c.file_path)
  if (c && c.path) pathCandidates.push(c.path)
  if (c && c.filePath) pathCandidates.push(c.filePath)

  const firstPath = pathCandidates.find(Boolean)
  if (firstPath) {
    return `<div class="read-summary">Reading: ${escapeHtml(String(firstPath))}</div>`
  }

  // Fallback: render the actual content as a code block, but default to a two-line collapsed preview
  const asContent = (c && (c.result && c.result.content)) || (c && (c.content || c.text)) || (c && c.input && c.input.content) || ''
  const code = (typeof asContent === 'object' && (asContent.code || asContent.text)) ? (asContent.code || asContent.text) : asContent
  const lang = (c && c.language) || (c && c.input && c.input.language) || ''
  const escaped = escapeHtml(String(code || ''))
  // Use inline styles on the returned HTML so scoped styles (and v-html) don't prevent the collapse from working.
  const preStyle = 'max-height:3.6em;overflow:hidden;transition:max-height 0.18s ease'
  const btnStyle = 'display:inline-block;margin-top:6px;background:transparent;border:none;color:#0a66ff;cursor:pointer;padding:2px 6px;font-size:13px'
  return `<div class="read-container"><pre class="code-block read-collapsed" style="${preStyle}"><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escaped}</code></pre><button class="read-toggle" data-full="false" style="${btnStyle}">Show more</button></div>`
}

function contentToHtml(c) {
  if (Array.isArray(c)) return c.map(contentToHtml).join('<br/>')

  // If it's a plain string, check special cases first (interruptions/commands)
  if (typeof c === 'string') {
    const s = c.trim()
    if (/request interrupted by user/i.test(s)) return `<div class="interruption">- user interruption -</div>`
    const mcmd = s.match(/<command-message>(.*?)<\/command-message>/i) || s.match(/<command-name>(.*?)<\/command-name>/i)
    if (mcmd && mcmd[1]) {
      const cmd = mcmd[1].trim()
      return `<div class="command-msg">command: ${escapeHtml(cmd.startsWith('/') ? cmd : '/' + cmd)}</div>`
    }
    return escapeHtml(c)
  }
  // treat null/undefined as empty
  if (c == null) return ''
  if (typeof c !== 'object') return escapeHtml(String(c))

  // Extract a flat textual representation for special-case checks
  const flat = (c && ((c.text && String(c.text)) || (c.content && typeof c.content === 'string' && c.content) || (c.message && (c.message.content || c.message.text)))) || ''
  if (typeof flat === 'string' && /request interrupted by user/i.test(flat)) {
    return `<div class="interruption">- user interruption -</div>`
  }

  const t = c.type || (c.message && c.message.type) || null
  if (t === 'text' || t === 'message' || t === 'paragraph') return renderPlain(c)
  if (t === 'code' || t === 'program' || c.language) return renderCode(c)
  if (t === 'tool_result') return renderToolResult(c)
  // tool_use specific handlers
  if ((c.name === 'TodoWrite' || c.toolName === 'TodoWrite' || (c.message && c.message.name === 'TodoWrite')) ) {
    return renderTodoWrite(c)
  }
  // thinking block
  if (c.type === 'thinking' || t === 'thinking') {
    const thinkingText = c.thinking || ''
    if (!thinkingText) return ''
    
    const renderer = createCustomMarkdownRenderer()
    const thinkingHtml = marked.parse(escapeHtml(String(thinkingText)), { renderer })
    return '<div class="thinking-block">' + thinkingHtml + '</div>'
  }
  // ExitPlanMode tool
  if ((c.name === 'ExitPlanMode' || c.toolName === 'ExitPlanMode' || (c.message && c.message.name === 'ExitPlanMode'))) {
    const plan = (c.input && c.input.plan) || (c.plan) || ''
    if (!plan) return ''
    
    const renderer = createCustomMarkdownRenderer()
    const planHtml = marked.parse(escapeHtml(String(plan)), { renderer })
    return '<div class="exit-plan-mode">' + planHtml + '</div>'
  }
  // read tool: auto-expand and show code block
  if ((c.name === 'Read' || c.toolName === 'Read' || (c.action && c.action === 'read') || (c.message && c.message.name === 'Read') || (c.type === 'read'))) {
    return renderReadTool(c)
  }
  if (t === 'image') return renderImage(c)
  if (t === 'json' || t === 'object') return renderJson(c)
  if (t === 'markdown') return renderMarkdown(c)

  // Heuristics: tool_result-like structures
  if (c.type === 'tool_result' || (c.content && typeof c.content === 'string' && c.content.trim().startsWith('{'))) {
    return renderToolResult(c)
  }

  // Special-case: command-message blocks
  // e.g. <command-message>clear</command-message>
  if (typeof flat === 'string' && /<command-message>(.*?)<\/command-message>/i.test(flat)) {
    const m = flat.match(/<command-message>(.*?)<\/command-message>/i)
    const cmd = m && m[1] ? m[1].trim() : ''
    return `<div class="command-msg">command: ${escapeHtml(cmd.startsWith('/') ? cmd : '/' + cmd)}</div>`
  }

  // fallback: if has content array, render recursively
  if (c.content && Array.isArray(c.content)) return contentToHtml(c.content)

  // final fallback
  return escapeHtml(c.text || c.content || JSON.stringify(c))
}

const html = computed(() => contentToHtml(props.content))

// cleaned up: tool-use summary/expand logic removed

const detailHtml = computed(() => {
  // render full content using contentToHtml but prefer markdown for tool_result
  const c = props.content
  if (!c) return ''
  // if it contains a textual content that looks like markdown, use marked
  const text = (c.content || c.text || (c.message && (c.message.content || c.message.text)))
  if (typeof text === 'string' && (text.includes('\n') || /\[[ x\-]\]|#{1,6} /m.test(text))) {
    // escape HTML before parsing
    if (isCodeLike(String(text))) return `<pre class="code-block"><code>${escapeHtml(String(text))}</code></pre>`
    return marked.parse(escapeHtml(String(text)))
  }
  return contentToHtml(c)
})

// Heuristic: detect if text is code-like to avoid markdown promotion (headings, inline HTML)
function isCodeLike(text) {
  if (!text || typeof text !== 'string') return false
  const lines = text.split('\n')
  // multi-line and contains typical code tokens
  const codeTokens = /\bfunction\b|\basync\b|=>|\{|\}|;|console\.log\(|\bconst\b|\breturn\b|\bclass\b/
  const likelyCode = lines.length > 1 && codeTokens.test(text)
  if (likelyCode) return true
  // single-line heuristics: starts with //, or looks like code path, or contains backticks
  if (/^\s*\/\/|^\s*#\!/m.test(text)) return true
  if (/^\s*\w+\s*=\s*\w+/.test(text)) return true
  return false
}

// Raw JSON for copy button: either the object or JSON contained in text
// For ExitPlanMode, return the plan text instead of the full JSON
const rawJson = computed(() => {
  const c = props.content
  if (!c) return null
  
  // Special case for ExitPlanMode: copy the plan text
  
  // Special case for thinking block: copy the thinking text
  if (c.type === 'thinking') {
    return c.thinking || null
  }
  if (c.name === 'ExitPlanMode' || c.toolName === 'ExitPlanMode' || (c.message && c.message.name === 'ExitPlanMode')) {
    return (c.input && c.input.plan) || (c.plan) || null
  }
  
  if (typeof c === 'object') {
    try { return JSON.stringify(c, null, 2) } catch { return null }
  }
  // if string and parsable JSON
  if (typeof c === 'string') {
    try { const p = JSON.parse(c); return JSON.stringify(p, null, 2) } catch { return null }
  }
  return null
})

async function copyRaw() {
  const text = rawJson.value
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch (e) {
    // fallback
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  copied.value = true
  setTimeout(() => { copied.value = false }, 1500)
}

const copied = ref(false)

// Manage Read preview toggles: use delegated click handling to avoid adding per-instance state
onMounted(() => {
  document.addEventListener('click', (e) => {
    const btn = e.target && (e.target.closest && e.target.closest('.read-toggle'))
    if (!btn) return
    const container = btn.closest('.read-container')
    if (!container) return
    const pre = container.querySelector('.read-collapsed')
    const isFull = btn.getAttribute('data-full') === 'true'
    if (!pre) return
    if (isFull) {
      // collapse by restoring inline max-height
      pre.style.maxHeight = '3.6em'
      btn.setAttribute('data-full', 'false')
      btn.textContent = 'Show more'
    } else {
      // expand by removing max-height constraint
      pre.style.maxHeight = 'none'
      btn.setAttribute('data-full', 'true')
      btn.textContent = 'Show less'
    }
  })
  // After mount, replace any data-code blocks with a Vue CodeBlock instance rendered in-place
  const replaceCodeBlocks = async () => {
    // Lazy load CodeBlock component to avoid circular deps
    try {
      const mod = await import('./CodeBlock.vue')
      const CodeBlockComp = mod.default
      // Find all placeholders
      const placeholders = document.querySelectorAll('.__code_placeholder')
      placeholders.forEach((ph) => {
        const language = ph.getAttribute('data-lang') || ''
        const raw = ph.getAttribute('data-raw') || ''
        // Create a mounting div
        const mount = document.createElement('div')
        ph.parentNode?.replaceChild(mount, ph)
        // mount the component
        try {
          const app = createApp(CodeBlockComp, { language, value: raw })
          if (mount) app.mount(mount)
        } catch (e) {
          // ignore mount errors
        }
      })
    } catch (e) {
      // ignore if dynamic import fails
    }
  }

  // Observe DOM changes to replace placeholders inserted via v-html
  const obs = new MutationObserver(async () => {
    await nextTick()
    replaceCodeBlocks()
  })
  obs.observe(document.body, { childList: true, subtree: true })
})
  // delegated handler for copying code blocks (buttons with .copy-code-btn)
  document.addEventListener('click', (e) => {
    const btn = e.target && (e.target.closest && e.target.closest('.copy-code-btn'))
    if (!btn) return
    const container = btn.closest('.read-container') || btn.closest('.message-renderer')
    if (!container) return
    // find nearest code or pre element
    const codeEl = container.querySelector('code') || container.querySelector('pre')
    if (!codeEl) return
    const text = codeEl.textContent || codeEl.innerText || ''
    // copy to clipboard with fallback
    (async () => {
      try { await navigator.clipboard.writeText(text) } catch (err) {
        const ta = document.createElement('textarea')
        ta.value = text
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
    })()
    const old = btn.textContent
    btn.textContent = 'Copied'
    setTimeout(() => { btn.textContent = old }, 1500)
  })

const isTodoWrite = computed(() => {
  const c = props.content
  if (!c) return false
  return (c.name === 'TodoWrite' || c.toolName === 'TodoWrite' || (c.message && c.message.name === 'TodoWrite'))
})

const todoHtml = computed(() => {
  const c = props.content
  if (!c) return ''
  return renderTodoWrite(c)
})

const systemNote = computed(() => {
  const c = props.content
  if (!c) return ''
  // look for a free-text note outside the todos
  const text = (c.content || c.text || (c.message && (c.message.content || c.message.text)) || '')
  if (!text) return ''
  // if text contains the 'Todos have been' phrase or is short confirmation-like, treat as system note
  if (/Todos? have|modified|successfully|modified successfully/i.test(text)) return String(text)
  return ''
})
</script>

<style scoped>
.message-renderer { white-space: pre-wrap; }
.code-block { background: #f5f5f5; padding: 8px; border-radius: 4px; overflow-x: auto }
.tool-result { background: #fff9c4; padding: 8px; border-radius: 4px }
.json-content { background: #f0f7ff; padding: 8px; border-radius: 4px }
.image-content img { max-width: 100%; height: auto }
.tool-use { border: 1px solid #eee; padding: 8px; border-radius: 6px; margin-bottom: 8px }
.tool-summary { display:flex; justify-content:space-between; align-items:center }
.tool-summary .left { flex:1 }
.tool-summary .meta { color: #666; font-size: 12px }
.tool-detail { margin-top: 8px }
.todo-container { border: 1px solid #eee; padding: 8px; border-radius: 6px; background: #fff }
.todo-list ul { padding-left: 20px }
.system-note { color: #666; font-size: 12px; margin-top: 8px; display: none }
.todo-list:hover + .system-note, .todo-container:hover .system-note { display: block }
.interruption { color: #666; font-style: italic; }
.command-msg { color: #666; font-weight: 600 }
.read-summary { font-size: 13px; color: #111; background: #f6f7fb; padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(2,6,23,0.04); }

/* copy button */
.copy-json { position: absolute; left: 6px; top: 6px; background: transparent; border: none; padding: 4px 6px; cursor: pointer; font-size: 12px; border-radius: 4px }
.copy-json:hover { background: rgba(0,0,0,0.04) }

.copy-json .copied-label { margin-left: 6px; font-size: 11px; color: #0b6; background: rgba(11,102,51,0.08); padding: 2px 6px; border-radius: 4px }

/* ensure headings inside message renderer are not too prominent */
.message-renderer h1, .message-renderer h2, .message-renderer h3 { margin: 0.2rem 0; font-weight: 600; font-size: 1rem }

/* wrapped code */
.message-renderer pre { white-space: pre-wrap; word-break: break-word }
.message-renderer code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Courier New', monospace }

/* Read tool collapsed preview: show only ~2 lines by default, expand on demand */
.read-container { position: relative }
.read-collapsed { max-height: 3.6em; overflow: hidden; position: relative }
.read-collapsed.read-expanded { max-height: none }
.read-toggle { display: inline-block; margin-top: 6px; background: transparent; border: none; color: #0a66ff; cursor: pointer; padding: 2px 6px; font-size: 13px }
.read-toggle:hover { text-decoration: underline }
.exit-plan-mode { background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 6px; padding: 12px; margin: 8px 0 }
.exit-plan-mode h1, .exit-plan-mode h2, .exit-plan-mode h3 { color: rgba(59, 130, 246, 0.9); margin: 0.5rem 0 }
.exit-plan-mode p { margin: 0.3rem 0; line-height: 1.5 }
.exit-plan-mode ul, .exit-plan-mode ol { margin: 0.3rem 0; padding-left: 1.5rem }
.exit-plan-mode li { margin: 0.2rem 0 }
.exit-plan-mode pre { margin: 0.4rem 0; background: rgba(0, 0, 0, 0.05); padding: 8px; border-radius: 4px }
.exit-plan-mode code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Courier New', monospace; font-size: 0.9em }
.thinking-block { background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.2); border-radius: 6px; padding: 12px; margin: 8px 0 }
.thinking-block h1, .thinking-block h2, .thinking-block h3 { color: rgba(168, 85, 247, 0.9); margin: 0.5rem 0 }
.thinking-block p { margin: 0.3rem 0; line-height: 1.5 }
.thinking-block ul, .thinking-block ol { margin: 0.3rem 0; padding-left: 1.5rem }
.thinking-block li { margin: 0.2rem 0 }
.thinking-block pre { margin: 0.4rem 0; background: rgba(0, 0, 0, 0.05); padding: 8px; border-radius: 4px }
.thinking-block code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Courier New', monospace; font-size: 0.9em }
</style>

<style>
/* Unscoped styles for ExitPlanMode and thinking block markdown (injected via v-html) */
.exit-plan-mode p { margin: 0.3rem 0 !important; line-height: 1.5 !important; }
.exit-plan-mode ul, .exit-plan-mode ol { margin: 0.3rem 0 !important; padding-left: 1.5rem !important; }
.exit-plan-mode li { margin: 0.2rem 0 !important; }
.exit-plan-mode pre { margin: 0.4rem 0 !important; background: rgba(0, 0, 0, 0.05) !important; padding: 8px !important; border-radius: 4px !important; }
.exit-plan-mode code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Courier New', monospace !important; font-size: 0.9em !important; }
.thinking-block p { margin: 0.3rem 0 !important; line-height: 1.5 !important; }
.thinking-block ul, .thinking-block ol { margin: 0.3rem 0 !important; padding-left: 1.5rem !important; }
.thinking-block li { margin: 0.2rem 0 !important; }
.thinking-block pre { margin: 0.4rem 0 !important; background: rgba(0, 0, 0, 0.05) !important; padding: 8px !important; border-radius: 4px !important; }
.thinking-block code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Courier New', monospace !important; font-size: 0.9em !important; }
</style>
