<template>
  <div ref="rootRef" class="message-renderer" @click="handleContentClick" @dblclick="handleContentDoubleClick">
    <div v-if="isTodoWrite" class="todo-container">
      <div class="todo-list" v-html="todoHtml"></div>
      <div v-if="systemNote" class="system-note" v-html="escapeHtml(systemNote)"></div>
    </div>
    <div v-else v-html="html"></div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, watch, nextTick, createApp, h } from 'vue'
import { marked } from 'marked'
import '../../../shared/messageContent.js'

// Configure marked to disable deprecated mangle option
marked.setOptions({ mangle: false, headerIds: false })

const messageContentUtils = globalThis.__ccodeViewerMessageContentUtils

if (!messageContentUtils) {
  throw new Error('messageContent utilities failed to load')
}

const { extractLeadingSkillPayload, getSkillContentSummary } = messageContentUtils

const props = defineProps({ content: { type: [Object, Array, String], required: true }, showRawCopy: { type: Boolean, default: true }, disableImagePreview: { type: Boolean, default: false } })
const rootRef = ref(null)

const DEFAULT_COLLAPSED_LINES = 4
const MIN_COLLAPSIBLE_LINES = 5
const COLLAPSE_LABEL_MORE = 'Show more'
const COLLAPSE_LABEL_LESS = 'Show less'

function getLineCount(value) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').trim()
  if (!text) return 0
  return text.split('\n').length
}

function shouldCollapseText(value, minLines = MIN_COLLAPSIBLE_LINES) {
  return getLineCount(value) > minLines
}

function getCollapsedMaxHeight(lines = DEFAULT_COLLAPSED_LINES) {
  return `${Number(lines) * 1.5 + 1.8}em`
}

function renderCollapsibleBlock(innerHtml, { sourceText, lines = DEFAULT_COLLAPSED_LINES, minLines = MIN_COLLAPSIBLE_LINES, className = '' } = {}) {
  if (!shouldCollapseText(sourceText, minLines)) return innerHtml
  const classes = ['collapsible-block', 'is-collapsible']
  if (className) classes.push(className)
  const buttonMore = escapeAttribute(COLLAPSE_LABEL_MORE)
  const buttonLess = escapeAttribute(COLLAPSE_LABEL_LESS)
  return `<div class="${classes.join(' ')}" data-expanded="false"><div class="collapsible-block-body" style="--collapsible-max-height:${getCollapsedMaxHeight(lines)}">${innerHtml}</div><button type="button" class="collapsible-toggle" aria-expanded="false" data-label-more="${buttonMore}" data-label-less="${buttonLess}">${buttonMore}</button></div>`
}

function renderCodePlaceholder(raw, language = '') {
  return `<div class="__code_placeholder" data-lang="${escapeAttribute(language)}" data-raw="${escapeAttribute(raw)}" data-collapsed-lines="${DEFAULT_COLLAPSED_LINES}" data-min-lines="${MIN_COLLAPSIBLE_LINES}"></div>`
}


// Convert ANSI escape codes to HTML with colors, backgrounds, and styles
function ansiToHtml(str) {
  if (!str || typeof str !== 'string') return ''

  const fgColors = {
    '30': '#000', '31': '#c33', '32': '#0b6', '33': '#ca0',
    '34': '#36c', '35': '#c3c', '36': '#0cc', '37': '#ccc',
    '90': '#666', '91': '#f66', '92': '#6f6', '93': '#ff6',
    '94': '#66f', '95': '#f6f', '96': '#6ff', '97': '#fff'
  }

  const bgColors = {
    '40': '#000', '41': '#c33', '42': '#0b6', '43': '#ca0',
    '44': '#36c', '45': '#c3c', '46': '#0cc', '47': '#ccc',
    '100': '#666', '101': '#f66', '102': '#6f6', '103': '#ff6',
    '104': '#66f', '105': '#f6f', '106': '#6ff', '107': '#fff'
  }

  let html = escapeHtml(str)
  let currentStyles = {
    color: null,
    bgColor: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    strikethrough: false
  }
  let inSpan = false

  function buildSpan(styles) {
    const parts = []
    if (styles.color) parts.push('color:' + styles.color)
    if (styles.bgColor) parts.push('background-color:' + styles.bgColor)
    if (styles.bold) parts.push('font-weight:bold')
    if (styles.dim) parts.push('opacity:0.6')
    if (styles.italic) parts.push('font-style:italic')
    if (styles.underline) parts.push('text-decoration:underline')
    if (styles.strikethrough) parts.push('text-decoration:line-through')
    return parts.length > 0 ? '<span style="' + parts.join(';') + '">' : ''
  }

  function hasAnyStyle(styles) {
    return styles.color || styles.bgColor || styles.bold || styles.dim ||
           styles.italic || styles.underline || styles.strikethrough
  }

  html = html.replace(/\x1b\[([0-9;]*)m/g, (match, codes) => {
    const parts = codes.split(';')
    let result = ''

    for (const code of parts) {
      if (code === '0' || code === '') {
        // Reset all
        currentStyles = { color: null, bgColor: null, bold: false, dim: false, italic: false, underline: false, strikethrough: false }
      } else if (fgColors[code]) {
        currentStyles.color = fgColors[code]
      } else if (bgColors[code]) {
        currentStyles.bgColor = bgColors[code]
      } else if (code === '1') {
        currentStyles.bold = true
      } else if (code === '2') {
        currentStyles.dim = true
      } else if (code === '3') {
        currentStyles.italic = true
      } else if (code === '4') {
        currentStyles.underline = true
      } else if (code === '9') {
        currentStyles.strikethrough = true
      } else if (code === '22') {
        currentStyles.bold = false
        currentStyles.dim = false
      } else if (code === '23') {
        currentStyles.italic = false
      } else if (code === '24') {
        currentStyles.underline = false
      } else if (code === '29') {
        currentStyles.strikethrough = false
      }
    }

    if (inSpan) {
      result += '</span>'
      inSpan = false
    }

    if (hasAnyStyle(currentStyles)) {
      result += buildSpan(currentStyles)
      inSpan = true
    }

    return result
  })

  if (inSpan) html += '</span>'

  return html
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttribute(s) {
  return escapeHtml(s)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function looksLikeMarkdownText(text) {
  if (typeof text !== 'string') return false
  const s = text.trim()
  if (!s) return false

  const markdownPatterns = [
    /(^|\n)\s*#{1,6}\s+\S/m,
    /(^|\n)\s*[-*+]\s+\S/m,
    /(^|\n)\s*\d+\.\s+\S/m,
    /```[\s\S]*?```/,
    /`[^`\n]+`/,
    /\*\*[^*\n]+\*\*/,
    /(^|\n)\s*>\s+\S/m,
    /\[[^\]]+\]\([^)]+\)/,
    /(^|\n)\s*\|.+\|.+\|?/m
  ]

  return markdownPatterns.some((re) => re.test(s))
}

function renderMarkdownLikeText(text) {
  const renderer = createCustomMarkdownRenderer()
  const markdownHtml = marked.parse(escapeHtml(String(text)), { renderer })
  const content = `<div class="markdown-text" style="white-space:normal;line-height:1.35">${markdownHtml}</div>`
  return renderCollapsibleBlock(content, { sourceText: text, className: 'markdown-collapsible' })
}

function renderSkillContent(text) {
  const renderer = createCustomMarkdownRenderer()
  const summaryText = getSkillContentSummary(text)
  const summary = escapeHtml(summaryText)
  const markdownHtml = marked.parse(escapeHtml(String(text)), { renderer })
  return `<details class="skill-content"><summary class="skill-content-summary" title="${escapeAttribute(summaryText)}">${summary}</summary><div class="skill-content-body">${markdownHtml}</div></details>`
}

function renderTextWithSkillPayload(text) {
  const { skillText, remainderText } = extractLeadingSkillPayload(String(text))
  if (!skillText) return null

  const parts = [renderSkillContent(skillText)]
  if (remainderText) {
    parts.push(looksLikeMarkdownText(remainderText) ? renderMarkdownLikeText(remainderText) : escapeHtml(remainderText))
  }
  return parts.join('<br/>')
}

function renderPlain(c) {
  if (typeof c === 'string') {
    const skillHtml = renderTextWithSkillPayload(c)
    if (skillHtml) return skillHtml
    if (looksLikeMarkdownText(c)) return renderMarkdownLikeText(c)
    return escapeHtml(c)
  }
  if (Array.isArray(c)) return c.map(renderPlain).join('<br/>')
  if (c && typeof c === 'object') {
    if (c.type === 'image') return '<span class="image-indicator">[Image]</span>'
    const text = typeof c.text === 'string' ? c.text : (typeof c.content === 'string' ? c.content : '')
    if (text) {
      const skillHtml = renderTextWithSkillPayload(text)
      if (skillHtml) return skillHtml
      if (looksLikeMarkdownText(text)) return renderMarkdownLikeText(text)
      return escapeHtml(text)
    }
    if (Array.isArray(c.content)) return contentToHtml(c.content)
    if (c.message) return contentToHtml(c.message.content || c.message.text || c.message)
    if (c.result && c.result.content != null) return contentToHtml(c.result.content)
    return renderJson(c)
  }
  return ''
}

function renderCode(c) {
  const code = (c && (c.code || c.text)) || ''
  const str = String(code || '')
  const language = (c && c.language) || ''
  return renderCodePlaceholder(str, language)
}

function renderToolResult(c) {
  const v = c ? (c.content ?? c.text ?? '') : ''

  // Handle empty tool results
  if (!v || (typeof v === 'string' && v.trim() === '')) {
    return '<div class="empty-tool-result">(no output)</div>'
  }

  if (Array.isArray(v)) {
    const rendered = v.map(item => contentToHtml(item)).filter(Boolean).join('<br/>')
    return rendered || '<div class="empty-tool-result">(no output)</div>'
  }

  if (v && typeof v === 'object') {
    if (Array.isArray(v.content)) return contentToHtml(v.content)
    if (typeof v.text === 'string' || typeof v.content === 'string') return contentToHtml(v)
    if (v.message) return contentToHtml(v.message.content || v.message.text || v.message)
    if (v.result && v.result.content != null) return contentToHtml(v.result.content)
    if (v.content && typeof v.content === 'object') return contentToHtml(v.content)
    return renderJson(v)
  }

  // if looks like JSON
  try {
    const parsed = JSON.parse(v)
    return renderCodePlaceholder(JSON.stringify(parsed, null, 2), 'json')
  } catch (e) {
    // fallback: render as text or markdown
    const str = String(v)
    const escaped = escapeHtml(str)

    // Check if contains ANSI codes and render with colors
    if (/\x1b\[/.test(str)) {
      const coloredHtml = ansiToHtml(str)
      return renderCollapsibleBlock('<pre class="tool-result">' + coloredHtml + '</pre>', { sourceText: str, className: 'tool-result-collapsible' })
    }

    if (isCodeLike(str)) {
      return renderCodePlaceholder(str)
    }

    if (str.includes('\n') || /\[[ x\-]\]|#{1,6} /m.test(str)) {
      // if markdown-like, render full markdown
      const rendered = marked.parse(escaped)
      return renderCollapsibleBlock(`<div class="tool-result">${rendered}</div>`, { sourceText: str, className: 'tool-result-collapsible' })
    }

    return renderCollapsibleBlock('<pre class="tool-result">' + escaped + '</pre>', { sourceText: str, className: 'tool-result-collapsible' })
  }
}

function renderThinking(c) {
  const thinkingText = typeof c.thinking === 'string' ? c.thinking.trim() : ''
  if (!thinkingText) {
    return '<div class="thinking-block thinking-block-placeholder"><span class="thinking-placeholder-label">thinking…</span></div>'
  }

  const renderer = createCustomMarkdownRenderer()
  const thinkingHtml = marked.parse(escapeHtml(String(thinkingText)), { renderer })
  const thinkingBody = renderCollapsibleBlock(thinkingHtml, { sourceText: thinkingText, className: 'thinking-collapsible' })
  return '<div class="thinking-block"><span class="thinking-placeholder-label">thinking…</span>' + thinkingBody + '</div>'
}

function formatDuration(durationMs) {
  const duration = Number(durationMs)
  if (!Number.isFinite(duration) || duration <= 0) return ''
  const seconds = duration / 1000
  return `${seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1).replace(/\.0$/, '')}s`
}

function renderAgentResult(c) {
  const result = c.toolUseResult || {}
  const badges = ['Subagent result']

  if (result.agentType) badges.push(String(result.agentType))
  if (result.status) badges.push(String(result.status))
  if (Number.isFinite(result.totalToolUseCount)) badges.push(`${result.totalToolUseCount} tools`)

  const duration = formatDuration(result.totalDurationMs)
  if (duration) badges.push(duration)

  const bodySource = result.content != null ? result.content : c.content
  const bodyHtml = contentToHtml(bodySource)
  const agentId = result.agentId ? `<div class="agent-result-id">Agent ${escapeHtml(String(result.agentId))}</div>` : ''
  const prompt = typeof result.prompt === 'string' ? result.prompt.trim() : ''
  const promptHtml = prompt
    ? `<details class="agent-result-prompt"><summary>Prompt</summary><pre class="agent-result-prompt-text">${escapeHtml(prompt)}</pre></details>`
    : ''

  return `<div class="agent-result"><div class="agent-result-meta">${badges.map(item => `<span class="agent-result-badge">${escapeHtml(item)}</span>`).join('')}</div>${agentId}${promptHtml}<div class="agent-result-body">${bodyHtml || '<div class="empty-tool-result">(no output)</div>'}</div></div>`
}

function renderJson(c) {
  try {
    const obj = c && (c.value || c.content) || c
    const jsonText = JSON.stringify(obj, null, 2)
    return renderCollapsibleBlock(`<pre class="json-content">${escapeHtml(jsonText)}</pre>`, { sourceText: jsonText, className: 'json-collapsible' })
  } catch (e) {
    const fallback = String(c)
    return renderCollapsibleBlock(`<pre class="json-content">${escapeHtml(fallback)}</pre>`, { sourceText: fallback, className: 'json-collapsible' })
  }
}

function renderImage(c) {
  // Support both direct url/src and nested source.data (base64)
  let src = ''
  if (c.url || c.src) {
    src = c.url || c.src
  } else if (c.source && c.source.type === 'base64' && c.source.data) {
    const mediaType = c.source.media_type || 'image/png'
    src = `data:${mediaType};base64,${c.source.data}`
  } else if (c.content) {
    src = c.content
  }
  if (!src) return '<span class="image-indicator">[Image - no source]</span>'
  const disablePreview = props.disableImagePreview ? 'true' : 'false'
  return `<div class="__image_placeholder" data-src="${escapeAttribute(src)}" data-disable-preview="${disablePreview}"></div>`
}

function renderMarkdown(c) {
  const src = (c && (c.text || c.content)) || ''
  // escape raw HTML before parsing markdown to avoid accidental tag promotion
  const markdownHtml = `<div class="markdown-text" style="white-space:normal;line-height:1.35">${marked.parse(escapeHtml(String(src)))}</div>`
  return renderCollapsibleBlock(markdownHtml, { sourceText: src, className: 'markdown-collapsible' })
}

// Shared custom markdown renderer with inline styles (for ExitPlanMode and thinking blocks)
function createCustomMarkdownRenderer() {
  const renderer = new marked.Renderer()
    
  renderer.heading = (text, level) => {
    const sizes = ['1.5em', '1.3em', '1.1em']
    const size = sizes[level - 1] || '1em'
    return `<h${level} style="margin:0.3rem 0;font-size:${size};font-weight:600">${text.trim()}</h${level}>\n`
  }

  renderer.paragraph = (text) => {
    return `<p style="margin:0.1rem 0;line-height:1.25">${text.trim()}</p>\n`
  }

  renderer.list = (body, ordered) => {
    const tag = ordered ? 'ol' : 'ul'
    return `<${tag} style="margin:0.1rem 0;padding-left:1.2rem;list-style-position:outside;list-style-type:${ordered ? 'decimal' : 'disc'}">${body.trim()}</${tag}>\n`
  }

  renderer.listitem = (text) => `<li style="margin:0;padding:0;line-height:1.25">${text.trim()}</li>`

  renderer.hr = () => {
    return `<hr style="margin:0.3rem 0;border:none;border-top:1px solid rgba(0,0,0,0.1)">\n`
  }

  renderer.code = (code, language) => {
    return `<pre style="margin:0.1rem 0;background:rgba(0,0,0,0.05);padding:6px;border-radius:4px"><code style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,'Courier New',monospace;font-size:0.9em;line-height:1.3">${code}</code></pre>\n`
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

function renderGrepTool(c) {
  const pattern = (c.input && c.input.pattern) || ''
  const path = (c.input && c.input.path) || ''
  const glob = (c.input && c.input.glob) || ''
  const type = (c.input && c.input.type) || ''
  const outputMode = (c.input && c.input.output_mode) || 'files_with_matches'
  const lineNumbers = (c.input && c.input['-n']) || false
  const caseInsensitive = (c.input && c.input['-i']) || false
  
  let args = []
  if (pattern) args.push(`pattern: "${escapeHtml(pattern)}"`)
  if (glob) args.push(`glob: "${escapeHtml(glob)}"`)
  if (type) args.push(`type: ${escapeHtml(type)}`)
  if (path) args.push(`path: ${escapeHtml(path)}`)
  if (outputMode !== 'files_with_matches') args.push(`output: ${escapeHtml(outputMode)}`)
  if (lineNumbers) args.push('-n')
  if (caseInsensitive) args.push('-i')
  
  return '<div class="grep-tool"><span class="grep-icon">🔍</span> <span class="grep-args">' + args.join(', ') + '</span></div>'
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
  return renderCodePlaceholder(String(code || ''), lang)
}

function isMarkdownFilePath(filePath) {
  if (typeof filePath !== 'string') return false
  return /\.md$/i.test(filePath.trim())
}

function renderWriteTool(c) {
  const msg = (c && c.message) || {}
  const input = (c && c.input) || msg.input || {}
  const filePath = input.file_path || input.filePath || input.path || c.file_path || c.filePath || c.path || msg.file_path || msg.filePath || msg.path || ''
  const rawContent = input.content ?? msg.content ?? ''
  const summaryText = filePath ? `Writing: ${String(filePath)}` : 'Writing file'
  const summary = `<div class="write-summary">${escapeHtml(summaryText)}</div>`

  if (!isMarkdownFilePath(filePath)) {
    return `<div class="write-tool">${summary}</div>`
  }

  const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent, null, 2)
  if (!content || !content.trim()) {
    return `<div class="write-tool write-tool-markdown">${summary}<div class="write-markdown-block"><em>(empty markdown)</em></div></div>`
  }

  const renderer = createCustomMarkdownRenderer()
  const markdownHtml = marked.parse(escapeHtml(content), { renderer })
  const body = renderCollapsibleBlock(`<div class="write-markdown-block" style="white-space:normal;line-height:1.3">${markdownHtml}</div>`, { sourceText: content, className: 'write-markdown-collapsible' })
  return `<div class="write-tool write-tool-markdown">${summary}${body}</div>`
}

// Render Copilot-specific tool blocks that have no Claude Code equivalent
function renderCopilotTool(c) {
  const name = c._copilotToolName
  const input = c.input || {}

  switch (name) {
    case 'report_intent':
      return '' // Hidden - intent logging is noise

    case 'apply_patch': {
      const patch = input.patch || ''
      if (!patch) return ''
      const lines = patch.split('\n')
      const summary = lines.find(l => l.startsWith('*** ')) || 'Patch applied'
      return `<details class="apply-patch-tool"><summary class="apply-patch-summary">${escapeHtml(summary)}</summary><pre class="apply-patch-body"><code>${escapeHtml(patch)}</code></pre></details>`
    }

    case 'edit': {
      const fp = input.file_path || ''
      return `<div class="copilot-tool-label edit-tool"><span class="tool-icon">&#9998;</span> Edit: <code>${escapeHtml(fp)}</code></div>`
    }

    case 'glob': {
      const pattern = input.pattern || ''
      const searchPath = input.path || ''
      const args = [pattern ? `pattern: "${escapeHtml(pattern)}"` : '', searchPath ? `path: ${escapeHtml(searchPath)}` : ''].filter(Boolean).join(', ')
      return `<div class="copilot-tool-label glob-tool"><span class="tool-icon">*</span> Glob: ${args}</div>`
    }

    case 'web_search': {
      const query = input.query || ''
      return `<div class="copilot-tool-label web-search-tool"><span class="tool-icon">&#128269;</span> Search: "${escapeHtml(query)}"</div>`
    }

    case 'sql': {
      const desc = input.description || ''
      const query = input.query || ''
      const label = desc || (query ? query.substring(0, 60) + '...' : 'SQL query')
      return `<div class="copilot-tool-label sql-tool"><span class="tool-icon">&#128451;</span> SQL: ${escapeHtml(label)}</div>`
    }

    case 'ask_user': {
      const question = input.question || ''
      return `<div class="copilot-tool-label ask-user-tool"><span class="tool-icon">&#10067;</span> Asking: ${escapeHtml(question)}</div>`
    }

    case 'task': {
      const desc = input.description || ''
      const taskName = input.name || ''
      const agentType = input.agent_type || ''
      const badges = ['Subagent task']
      if (agentType) badges.push(agentType)
      if (taskName) badges.push(taskName)
      const badgesHtml = badges.map(b => `<span class="agent-result-badge">${escapeHtml(b)}</span>`).join('')
      const promptText = input.prompt || ''
      const promptHtml = promptText
        ? `<details class="agent-result-prompt"><summary>Prompt</summary><pre class="agent-result-prompt-text">${escapeHtml(promptText.substring(0, 500))}</pre></details>`
        : ''
      return `<div class="agent-result"><div class="agent-result-meta">${badgesHtml}</div>${promptHtml}</div>`
    }

    case 'read_agent': {
      const agentId = input.agent_id || ''
      return `<div class="copilot-tool-label"><span class="tool-icon">&#128196;</span> Reading agent: ${escapeHtml(agentId)}</div>`
    }

    default:
      // Unknown copilot block - compact label instead of full JSON dump
      return `<div class="unknown-block">Unknown block: ${escapeHtml(name)}</div>`
  }
}

function contentToHtml(c) {
  if (Array.isArray(c)) return c.map(contentToHtml).filter(Boolean).join('<br/>')

  // If it's a plain string, check special cases first (interruptions/commands)
  if (typeof c === 'string') {
    const s = c.trim()
    if (/request interrupted by user/i.test(s)) return `<div class="interruption">- user interruption -</div>`
    const mcmd = s.match(/<command-message>(.*?)<\/command-message>/i) || s.match(/<command-name>(.*?)<\/command-name>/i)
    if (mcmd && mcmd[1]) {
      const cmd = mcmd[1].trim()
      return `<div class="command-msg">command: ${escapeHtml(cmd.startsWith('/') ? cmd : '/' + cmd)}</div>`
    }
    return renderPlain(c)
  }
  // treat null/undefined as empty
  if (c == null) return ''
  if (typeof c !== 'object') return escapeHtml(String(c))

  // Extract a flat textual representation for special-case checks
  const flat = (c && ((c.text && String(c.text)) || (c.content && typeof c.content === 'string' && c.content) || (c.message && (c.message.content || c.message.text)))) || ''
  if (typeof flat === 'string' && /request interrupted by user/i.test(flat)) {
    return `<div class="interruption">- user interruption -</div>`
  }

  if (c.toolUseResult) return renderAgentResult(c)

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
    return renderThinking(c)
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
  // Bash tool: show command in shell-like format
  // Grep tool: show search parameters
  if ((c.name === 'Grep' || c.toolName === 'Grep' || (c.message && c.message.name === 'Grep'))) {
    return renderGrepTool(c)
  }
  if ((c.name === 'Write' || c.toolName === 'Write' || (c.message && c.message.name === 'Write'))) {
    return renderWriteTool(c)
  }
  if ((c.name === 'Bash' || c.toolName === 'Bash' || (c.message && c.message.name === 'Bash'))) {
    const cmd = (c.input && c.input.command) || (c.command) || ''
    const desc = (c.input && c.input.description) || (c.description) || ''
    if (!cmd) return ''
    const escapedCmd = escapeHtml(cmd)
    const escapedDesc = desc ? escapeHtml(desc) : ''
    return '<div class="bash-tool"><span class="bash-prompt">\$</span> <code>' + escapedCmd + '</code>' + (desc ? '<div class="bash-desc">' + escapedDesc + '</div>' : '') + '</div>'
  }
  if ((c.name === 'Read' || c.toolName === 'Read' || (c.action && c.action === 'read') || (c.message && c.message.name === 'Read') || (c.type === 'read'))) {
    return renderReadTool(c)
  }
  // Edit tool
  if (c.name === 'Edit' || (c.message && c.message.name === 'Edit')) {
    const fp = (c.input && c.input.file_path) || ''
    return `<div class="copilot-tool-label edit-tool"><span class="tool-icon">&#9998;</span> Edit: <code>${escapeHtml(fp)}</code></div>`
  }
  // Glob tool
  if (c.name === 'Glob' || (c.message && c.message.name === 'Glob')) {
    const pattern = (c.input && c.input.pattern) || ''
    const searchPath = (c.input && c.input.path) || ''
    const args = [pattern ? `pattern: "${escapeHtml(pattern)}"` : '', searchPath ? `path: ${escapeHtml(searchPath)}` : ''].filter(Boolean).join(', ')
    return `<div class="copilot-tool-label glob-tool"><span class="tool-icon">*</span> Glob: ${args}</div>`
  }
  // WebSearch tool
  if (c.name === 'WebSearch' || (c.message && c.message.name === 'WebSearch')) {
    const query = (c.input && c.input.query) || (c.input && c.input.prompt) || ''
    return `<div class="copilot-tool-label web-search-tool"><span class="tool-icon">&#128269;</span> Search: "${escapeHtml(query)}"</div>`
  }
  // AskUserQuestion tool
  if (c.name === 'AskUserQuestion' || (c.message && c.message.name === 'AskUserQuestion')) {
    const questions = c.input && c.input.questions
    if (!Array.isArray(questions) || questions.length === 0) return ''
    const q = questions[0]
    const header = q.header ? `<span class="ask-header">${escapeHtml(q.header)}</span> ` : ''
    const opts = Array.isArray(q.options) ? q.options.map(o => `<span class="ask-option">${escapeHtml(o.label)}</span>`).join(' ') : ''
    return `<div class="copilot-tool-label ask-user-tool"><span class="tool-icon">&#10067;</span> ${header}${escapeHtml(q.question || '')}${opts ? '<div class="ask-options">' + opts + '</div>' : ''}</div>`
  }
  // Agent tool (subagent spawn)
  if (c.name === 'Agent' || (c.message && c.message.name === 'Agent')) {
    const desc = (c.input && c.input.description) || ''
    const agentType = (c.input && c.input.subagent_type) || ''
    const badges = ['Subagent']
    if (agentType) badges.push(agentType)
    const badgesHtml = badges.map(b => `<span class="agent-result-badge">${escapeHtml(b)}</span>`).join('')
    const promptText = (c.input && c.input.prompt) || ''
    const promptHtml = promptText
      ? `<details class="agent-result-prompt"><summary>Prompt</summary><pre class="agent-result-prompt-text">${escapeHtml(promptText.substring(0, 500))}</pre></details>`
      : ''
    return `<div class="agent-result"><div class="agent-result-meta">${badgesHtml}</div>${desc ? `<div class="agent-desc">${escapeHtml(desc)}</div>` : ''}${promptHtml}</div>`
  }
  // Skill tool
  if (c.name === 'Skill' || (c.message && c.message.name === 'Skill')) {
    const skillName = (c.input && c.input.skill) || ''
    const args = (c.input && c.input.args) || ''
    return `<div class="copilot-tool-label skill-tool"><span class="tool-icon">&#9889;</span> Skill: <code>/${escapeHtml(skillName)}</code>${args ? ` ${escapeHtml(args.substring(0, 100))}` : ''}</div>`
  }
  // EnterPlanMode tool
  if (c.name === 'EnterPlanMode' || (c.message && c.message.name === 'EnterPlanMode')) {
    return '<div class="plan-mode-indicator">&#128204; Entering plan mode...</div>'
  }
  // TaskCreate tool
  if (c.name === 'TaskCreate' || (c.message && c.message.name === 'TaskCreate')) {
    const subject = (c.input && c.input.subject) || ''
    return `<div class="task-tool-label"><span class="tool-icon">&#9745;</span> Task: ${escapeHtml(subject)}</div>`
  }
  // TaskUpdate tool
  if (c.name === 'TaskUpdate' || (c.message && c.message.name === 'TaskUpdate')) {
    const status = (c.input && c.input.status) || ''
    const subject = (c.input && c.input.subject) || ''
    return `<div class="task-tool-label"><span class="tool-icon">&#9998;</span> Task ${escapeHtml(status)}${subject ? ': ' + escapeHtml(subject) : ''}</div>`
  }
  // TaskOutput tool
  if (c.name === 'TaskOutput' || (c.message && c.message.name === 'TaskOutput')) {
    const taskId = (c.input && c.input.task_id) || ''
    return `<div class="task-tool-label"><span class="tool-icon">&#128196;</span> Task output: ${escapeHtml(taskId)}</div>`
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

  // Copilot-specific tool renderers
  if (c._copilotToolName) return renderCopilotTool(c)

  // fallback: if has content array, render recursively
  if (c.content && Array.isArray(c.content)) return contentToHtml(c.content)
  if (c.message) return contentToHtml(c.message.content || c.message.text || c.message)
  if (c.result && c.result.content != null) return contentToHtml(c.result.content)
  if (c.content && typeof c.content === 'object') return contentToHtml(c.content)

  // final fallback - unknown block detection
  // If the object has a recognizable type or name, show compact label instead of JSON dump
  if (t || c.name) {
    const identifier = c.name || t
    return `<div class="unknown-block">Unknown block: ${escapeHtml(String(identifier))}</div>`
  }
  // Truly unknown structure - show full JSON
  return renderJson(c)
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


async function replaceCodeBlocks() {
  const root = rootRef.value
  if (!root) return

  try {
    const mod = await import('./CodeBlock.vue')
    const CodeBlockComp = mod.default
    const placeholders = root.querySelectorAll('.__code_placeholder')
    placeholders.forEach((ph) => {
      const language = ph.getAttribute('data-lang') || ''
      const raw = ph.getAttribute('data-raw') || ''
      const collapsedLines = Number.parseInt(ph.getAttribute('data-collapsed-lines') || String(DEFAULT_COLLAPSED_LINES), 10)
      const minCollapsibleLines = Number.parseInt(ph.getAttribute('data-min-lines') || String(MIN_COLLAPSIBLE_LINES), 10)
      const mount = document.createElement('div')

      ph.parentNode?.replaceChild(mount, ph)

      try {
        const app = createApp(CodeBlockComp, {
          language,
          value: raw,
          collapsedLines: Number.isFinite(collapsedLines) ? collapsedLines : DEFAULT_COLLAPSED_LINES,
          minCollapsibleLines: Number.isFinite(minCollapsibleLines) ? minCollapsibleLines : MIN_COLLAPSIBLE_LINES
        })
        if (mount) app.mount(mount)
      } catch (e) {
        // ignore mount errors
      }
    })
  } catch (e) {
    // ignore if dynamic import fails
  }
}

async function replaceImages() {
  const root = rootRef.value
  if (!root) return

  try {
    const { ElImage } = await import('element-plus')
    const placeholders = root.querySelectorAll('.__image_placeholder')
    placeholders.forEach((ph) => {
      const src = ph.getAttribute('data-src') || ''
      const disablePreview = ph.getAttribute('data-disable-preview') === 'true'
      const mount = document.createElement('div')
      ph.parentNode?.replaceChild(mount, ph)
      try {
        const imageProps = {
          src: src,
          style: 'max-height: 4em; width: auto; border-radius: 4px; cursor: pointer',
          fit: 'contain'
        }
        if (!disablePreview) {
          imageProps.previewSrcList = [src]
        }
        const app = createApp({
          render() {
            return h(ElImage, imageProps)
          }
        })
        if (mount) app.mount(mount)
      } catch (e) {
        // ignore mount errors
      }
    })
  } catch (e) {
    // ignore if dynamic import fails
  }
}

async function enhanceDynamicContent() {
  await nextTick()
  await replaceCodeBlocks()
  await replaceImages()
}

function handleContentClick(event) {
  const toggle = event.target instanceof Element ? event.target.closest('.collapsible-toggle') : null
  if (!toggle) return

  const container = toggle.closest('.collapsible-block.is-collapsible')
  if (!container) return

  toggleCollapsibleContainer(container, toggle)
}

function toggleCollapsibleContainer(container, toggle = null) {
  if (!container) return

  const isExpanded = container.getAttribute('data-expanded') === 'true'
  const nextExpanded = !isExpanded
  const toggleButton = toggle || container.querySelector('.collapsible-toggle')
  const moreLabel = toggleButton?.getAttribute('data-label-more') || COLLAPSE_LABEL_MORE
  const lessLabel = toggleButton?.getAttribute('data-label-less') || COLLAPSE_LABEL_LESS

  container.setAttribute('data-expanded', nextExpanded ? 'true' : 'false')
  if (toggleButton) {
    toggleButton.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false')
    toggleButton.textContent = nextExpanded ? lessLabel : moreLabel
  }
}

function handleContentDoubleClick(event) {
  if (!(event.target instanceof Element)) return
  if (event.target.closest('.collapsible-toggle, button, a, input, textarea, summary, .el-image')) return

  const body = event.target.closest('.collapsible-block-body')
  if (!body) return

  const container = body.closest('.collapsible-block.is-collapsible')
  if (!container) return

  toggleCollapsibleContainer(container)
}

onMounted(() => {
  enhanceDynamicContent()
})

watch(html, () => {
  enhanceDynamicContent()
}, { flush: 'post' })

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
.code-block { background: var(--code-bg); color: var(--code-text); padding: var(--sp-2); border-radius: var(--radius-sm); overflow-x: auto; border: none; }
.tool-result { background: var(--accent-light); padding: var(--sp-2); border-radius: var(--radius-sm); }
.json-content { background: var(--bg); padding: var(--sp-2); border-radius: var(--radius-sm); border: 1px solid var(--border); }
.image-content img { max-width: 100%; height: auto }
.tool-use { border: none; border-left: 2px solid var(--border-strong); padding: var(--sp-1) var(--sp-2); border-radius: 0; margin-bottom: var(--sp-1); background: transparent; }
.tool-summary { display:flex; justify-content:space-between; align-items:center }
.tool-summary .left { flex:1 }
.tool-summary .meta { color: var(--text-muted); font-size: 12px }
.tool-detail { margin-top: var(--sp-1); }
.todo-container { border: none; border-left: 2px solid var(--border-strong); padding: var(--sp-1) var(--sp-2); border-radius: 0; background: transparent; }
.todo-list ul { padding-left: 20px; }
.system-note { color: var(--text-muted); font-size: 11px; margin-top: var(--sp-1); display: none }
.todo-list:hover + .system-note, .todo-container:hover .system-note { display: block }
.interruption { color: var(--text-muted); font-style: italic; }
.command-msg { color: var(--text-secondary); font-weight: 600; font-family: var(--font-mono); font-size: 12px; }
.read-summary {
  font-size: 13px;
  color: var(--text-secondary);
  background: transparent;
  padding: var(--sp-1) var(--sp-2);
  border-radius: 0;
  border: none;
  border-left: 2px solid var(--tool-read);
  font-family: var(--font-mono);
}
.grep-tool {
  font-size: 13px;
  color: var(--text-secondary);
  background: transparent;
  padding: var(--sp-1) var(--sp-2);
  border-radius: 0;
  border: none;
  border-left: 2px solid var(--tool-grep);
  display: flex;
  align-items: center;
  gap: var(--sp-1);
}
.grep-tool .grep-icon { font-size: 14px; }
.grep-tool .grep-args { font-family: var(--font-mono); font-size: 12px; }

/* ensure headings inside message renderer are not too prominent */
.message-renderer { position: relative }
.message-renderer h1, .message-renderer h2, .message-renderer h3 { margin: 0.2rem 0; font-weight: 600; font-size: 1rem; color: var(--text); }

/* wrapped code */
.message-renderer pre { white-space: pre-wrap; word-break: break-word }
.message-renderer code { font-family: var(--font-mono); }
</style>

<style>
/* Unscoped styles for ExitPlanMode and thinking block markdown (injected via v-html) */
.exit-plan-mode p { margin: 0.3rem 0 !important; line-height: 1.5 !important; }
.exit-plan-mode ul, .exit-plan-mode ol { margin: 0.3rem 0 !important; padding-left: 1.5rem !important; }
.exit-plan-mode li { margin: 0.2rem 0 !important; }
.exit-plan-mode pre { margin: 0.4rem 0 !important; background: var(--code-bg) !important; color: var(--code-text) !important; padding: 8px !important; border-radius: 4px !important; }
.exit-plan-mode code { font-family: var(--font-mono) !important; font-size: 0.9em !important; }
.thinking-block p { margin: 0.3rem 0 !important; line-height: 1.5 !important; }
.thinking-block ul, .thinking-block ol { margin: 0.3rem 0 !important; padding-left: 1.5rem !important; }
.thinking-block li { margin: 0.2rem 0 !important; }
.thinking-block pre { margin: 0.4rem 0 !important; background: var(--code-bg) !important; color: var(--code-text) !important; padding: 8px !important; border-radius: 4px !important; }
.thinking-block code { font-family: var(--font-mono) !important; font-size: 0.9em !important; }
/* ExitPlanMode styles */
.exit-plan-mode {
  background: none !important;
  border: none !important;
  border-left: 2px solid var(--tool-plan) !important;
  border-radius: 0 !important;
  padding: 2px 0 2px var(--sp-3) !important;
  margin: var(--sp-1) 0 !important;
}
.exit-plan-mode h1, .exit-plan-mode h2, .exit-plan-mode h3 { color: var(--info) !important; margin: 0.3rem 0 !important; font-size: 0.95em; }
/* thinking-block styles — blockquote style */
.thinking-block {
  background: none !important;
  border: none !important;
  border-left: 2px solid var(--text-muted) !important;
  border-radius: 0 !important;
  padding: 2px 0 2px var(--sp-3) !important;
  margin: var(--sp-1) 0 !important;
  color: var(--text-muted) !important;
  font-size: 13px;
}
.thinking-block h1, .thinking-block h2, .thinking-block h3 { color: var(--text-muted) !important; margin: 0.3rem 0 !important; font-size: 0.95em; }
.thinking-placeholder-label {
  display: block;
  color: var(--text-muted);
  font-style: italic;
  font-size: 11px;
  margin-bottom: 2px;
  opacity: 0.7;
}
</style>
