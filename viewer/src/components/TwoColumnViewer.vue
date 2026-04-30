<template>
  <div class="two-col">
    <div class="left">
      <h3 class="column-header">Users</h3>
      <div class="left-scroll">
        <div v-if="loading">Loading...</div>
        <ul v-else>
          <li v-for="u in visibleUsers" :key="u.id" class="user-item" :class="{ selected: selectedUser && selectedUser.id === u.id }">
            <template v-if="u.nonInteractive && !u.interruption">
              <div
                class="user-preview user-preview-static muted-entry"
                :class="{ 'user-preview-truncated': u.isLongPreview }"
                :title="u.isLongPreview ? u.preview : ''"
              >
                <span class="user-preview-text">{{ u.preview }}</span>
                <span v-if="u.isLongPreview" class="user-preview-more" aria-hidden="true">...</span>
              </div>
            </template>
            <template v-else>
              <button
                type="button"
                class="user-preview user-preview-button"
                :class="{
                  'user-preview-truncated': u.isLongPreview,
                  'user-preview-command': u.isCommand,
                  'muted-entry': u.interruption
                }"
                :title="u.isLongPreview ? u.preview : ''"
                :aria-label="u.preview || 'User message'"
                @click="selectUser(u)"
              >
                <span class="user-preview-text">{{ u.preview }}</span>
                <span v-if="u.isLongPreview" class="user-preview-more" aria-hidden="true">...</span>
              </button>
            </template>
          </li>
        </ul>
      </div>
    </div>
    <div class="right">
      <h3 class="column-header">Conversation</h3>
      <div class="right-scroll">
        <div v-if="allMessages.length === 0">No messages</div>
        <ul>
  <li
    v-for="(m, idx) in allMessages"
    :key="m.id || idx"
    :id="`msg-${m.id || idx}`"
    class="assistant-item"
    :class="{ 'flash': m._flash, 'compact-entry': m._compactDisplay }"
    :data-display="m.displayType"
  >
            <div class="assistant-card" :class="{ muted: m.muted, 'with-toolbar': !m._hideToolbar }">
            <div class="assistant-full">
              <div v-if="!m._hideToolbar" class="assistant-toolbar">
                <div class="copy-group">
                  <ActionIconButton class="copy-btn text-copy" :class="{ copied: m._copiedText }" icon="copy" label="Copy text" active-label="Copied text" @click.prevent="copyText(m)" />
                  <ActionIconButton class="copy-btn raw-copy" :class="{ copied: m._copiedRaw }" icon="document" label="Copy source JSON" active-label="Copied raw" @click.prevent="copyRaw(m)" />
                </div>
              </div>
              <MessageRenderer :content="m.content" :showRawCopy="false" />
              <div v-if="m.muted" class="muted-note">- user interruption -</div>
            </div>
          </div>
        </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script>
import MessageRenderer from './MessageRenderer.vue'
import ActionIconButton from './ActionIconButton.vue'
import '../../../shared/messageContent.js'

const messageContentUtils = globalThis.__ccodeViewerMessageContentUtils

if (!messageContentUtils) {
  throw new Error('messageContent utilities failed to load')
}

const { extractPlainText, getUserPreviewText, hasUserVisibleContent } = messageContentUtils
import { AUTO_SELECT_FIRST_USER_ID } from '../constants'

const WIDE_CHAR_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF01-\uFF60\uFFE0-\uFFE6]/
const USER_PREVIEW_TRUNCATION_THRESHOLD = 120

export default {
  components: { MessageRenderer, ActionIconButton },
  props: ['file', 'highlightUserId'],
  data() {
    return {
      users: [],
      mapping: {},
      allMessages: [],
      loading: false,
      selectedUser: null,
      es: null,
      sessionCache: new Map() // Cache for session data
    }
  },
  computed: {
    visibleUsers() {
      return this.users.filter(u => !u.hideFromUsers)
    }
  },
  async mounted() { await this.load() },
  watch: {
    file: { immediate: true, handler() { this.load() } },
    highlightUserId: {
      handler(userId) {
        if (userId && this.visibleUsers.length > 0) {
          const user = this.resolveHighlightedUser(userId)
          if (user) {
            this.$nextTick(() => {
              this.selectUser(user)
            })
          }
        }
      }
    }
  },
  methods: {
    async load() {
      if (!this.file) return

      // Check cache first
      if (this.sessionCache.has(this.file)) {
        console.log('[TwoCol] Cache HIT for', this.file)
        const cached = this.sessionCache.get(this.file)
        this.users = cached.users
        this.mapping = cached.mapping
        this.selectedUser = null
        this.loading = false
        this.rebuildAllMessages()

        // Auto-highlight if needed
        if (this.highlightUserId) {
          const user = this.resolveHighlightedUser(this.highlightUserId)
          if (user) {
            this.$nextTick(() => {
              this.selectUser(user)
            })
          }
        }

        // Still setup SSE for live updates
        this.setupEventSource()
        return
      }

      this.loading = true
      console.log('[TwoCol] Cache MISS, fetching...', this.file)
      const fetchStart = performance.now()
      try {
        const res = await fetch('/api/session-mapping?file=' + encodeURIComponent(this.file))
        const json = await res.json()
        console.log('[TwoCol] Fetch took', (performance.now() - fetchStart).toFixed(0), 'ms')
        // Clean initial users/mapping: remove skippable entries and mark interruptions
        const rawUsers = json.users || []
        const rawMapping = json.mapping || {}
        // process users: remove skippable and decorate command/interruption entries
        this.users = (rawUsers || []).map(u => {
          const rawTxt = this.extractText(u.content || u.preview || '')
          if (this.isSkippable(rawTxt)) return null
          return this.decorateUser(u)
        }).filter(Boolean)
        // process mapping arrays
        const cleaned = {}
        for (const [k, arr] of Object.entries(rawMapping)) {
          const kept = (arr || []).filter(item => {
            const txt = this.extractText(item.content)
            return !this.isSkippable(txt)
          }).map(item => {
            const txt = this.extractText(item.content)
            if (this.isInterruptedByUser(txt)) {
              item.muted = true
              item._noCopy = true
            }
            return item
          })
          if (kept.length > 0) cleaned[k] = kept
        }
  this.mapping = cleaned
  this.selectedUser = null

        // Cache the processed data
        this.sessionCache.set(this.file, {
          users: this.users,
          mapping: this.mapping
        })

  // build the flat ordered message stream for right-side full view
  this.rebuildAllMessages()

        // setup SSE
        this.setupEventSource()
      } catch (e) { console.error(e) }
      this.loading = false

      // Auto-highlight if highlightUserId is set
      if (this.highlightUserId) {
        const user = this.resolveHighlightedUser(this.highlightUserId)
        if (user) {
          this.$nextTick(() => {
            this.selectUser(user)
          })
        }
      }
    },
    resolveHighlightedUser(userId) {
      if (!userId || this.visibleUsers.length === 0) return null
      if (userId === AUTO_SELECT_FIRST_USER_ID) return this.visibleUsers[0] || null
      return this.visibleUsers.find(u => u.id === userId) || null
    },
    setupEventSource() {
      this.cleanupEventSource()
      try {
        this.es = new EventSource('/api/events?file=' + encodeURIComponent(this.file))
        this.es.addEventListener('session_appended', (ev) => {
          try {
            const d = JSON.parse(ev.data)
            const m = JSON.parse(d.line)
            this.integrateMessage(m)
            // Update cache when new messages arrive
            this.sessionCache.set(this.file, {
              users: this.users,
              mapping: this.mapping
            })
          } catch (e) { console.error('SSE parse error', e) }
        })
      } catch (e) { console.error('EventSource error', e) }
    },
    cleanupEventSource() {
      if (this.es) {
        try { this.es.close() } catch (e) {}
        this.es = null
      }
    },
    integrateMessage(m) {
      // Normalize similar to server mapping: determine id, type, content
      const id = m.uuid || (m.message && m.message.id) || `i_${Date.now()}`
      let rawType = m.type
      let type = rawType
      const isMetaUser = rawType === 'user' && m.isMeta

      // If message type indicates a tool, treat as assistant
      if (type === 'tool_use' || type === 'tool_result' || type === 'tool') type = 'assistant'
      if (isMetaUser) type = 'assistant'
      if (!type && m.message && m.message.role) type = m.message.role

      // If message content contains tool entries, treat as assistant
      const contentCandidate = (m.message && m.message.content) || m.content
      if (Array.isArray(contentCandidate)) {
        for (const item of contentCandidate) {
          if (item && (item.type === 'tool_result' || item.type === 'tool_use' || item.type === 'tool')) {
            type = 'assistant'
            break
          }
        }
      }

  const content = this.getRenderableContent(m)
  const flatText = this.extractText(content)

  // Skip unhelpful messages: Caveat hints and raw local-command stdout
  if (this.isSkippable(flatText)) return

      // If rawType starts with 'tool', force assistant
      if (typeof rawType === 'string' && rawType.startsWith('tool')) type = 'assistant'

      if (type === 'user') {
        this.users.push(this.decorateUser({ id, content, timestamp: m.timestamp }))
        this.mapping[id] = []
      } else {
        // If this is a tool_result that references a parent assistant, try to merge
        if (rawType === 'tool_result' && m.parentUuid) {
          // find assistant in mappings by id or raw.uuid
          let found = null
          for (const [k, arr] of Object.entries(this.mapping)) {
            found = arr.find(a => a.id === m.parentUuid || (a.raw && a.raw.uuid === m.parentUuid))
            if (found) {
              // append to found.content
              if (Array.isArray(found.content)) found.content.push(content)
              else found.content = [found.content, content]
              return
            }
          }
        }

        // assign to explicit parent user or fall back to last user
        let assigned = null
        if (m.parentUuid) assigned = this.users.find(u => u.id === m.parentUuid)
        if (!assigned && this.users.length > 0) assigned = this.users[this.users.length - 1]
  const assistantOut = { id, content, timestamp: m.timestamp, raw: m }
        // Mark interrupted-by-user messages as muted (grey, no copy)
        if (this.isInterruptedByUser(flatText)) {
          assistantOut.muted = true
          assistantOut._noCopy = true
        }
        if (assigned) {
          const arr = this.mapping[assigned.id] || []
          arr.push(assistantOut)
          this.mapping[assigned.id] = arr
        } else {
          const key = '__no_user__'
          const arr = this.mapping[key] || []
          arr.push(assistantOut)
          this.mapping[key] = arr
        }
        // rebuild flat stream after integrating
        this.rebuildAllMessages()
      }
    },
    decorateUser(user) {
      const out = Object.assign({}, user)
      const rawContent = out.content || out.preview || ''
      const sidebarText = getUserPreviewText(rawContent)

      out.preview = sidebarText
      out.hideFromUsers = !hasUserVisibleContent(rawContent)
      out.nonInteractive = false
      out.isCommand = false

      if (this.isInterruptedByUser(sidebarText)) {
        out.interruption = true
        out.preview = '- user interruption -'
        out.nonInteractive = true
      } else {
        const cm = String(sidebarText).match(/<command-message>(.*?)<\/command-message>/i) || String(sidebarText).match(/<command-name>(.*?)<\/command-name>/i)
        if (cm && cm[1]) {
          const cmd = cm[1].trim()
          out.command = cmd
          out.preview = `command: ${cmd.startsWith('/') ? cmd : '/' + cmd}`
          out.isCommand = true
        }
      }

      out.isLongPreview = this.isLongPreview(out.preview)

      return out
    },
    getRenderableContent(message) {
      const baseContent = (message.message && (message.message.content || message.message)) || message.content || message
      if (message && message.toolUseResult) {
        return {
          type: 'agent_result',
          content: message.toolUseResult.content ?? baseContent,
          toolUseResult: message.toolUseResult
        }
      }
      return baseContent
    },
    rebuildAllMessages() {
      const out = []
      // include any orphaned assistant messages first
      if (this.mapping['__no_user__']) {
        for (const a of this.mapping['__no_user__']) {
          const content = a.content || a.preview || (a.raw ? (typeof a.raw === 'string' ? a.raw : JSON.stringify(a.raw)) : '')
          out.push(Object.assign({ displayType: 'assistant', content }, a))
        }
      }
      for (const u of this.users) {
        const ucontent = u.content || u.preview || ''
        const isCompactDisplay = Boolean(u.isCommand || u.interruption)
        out.push(Object.assign({
          displayType: 'user',
          content: ucontent,
          _compactDisplay: isCompactDisplay,
          _hideToolbar: isCompactDisplay
        }, u))
        const replies = this.mapping[u.id] || []
        for (const a of replies) {
          const content = a.content || a.preview || (a.raw ? (typeof a.raw === 'string' ? a.raw : JSON.stringify(a.raw)) : '')
          out.push(Object.assign({ displayType: 'assistant', content }, a))
        }
      }
      this.allMessages = out
    },
    isSkippable(text) {
      if (!text) return false
      const low = String(text).toLowerCase()
      // skip caveat notes and local-command-stdout blocks
      if (low.includes('caveat:') || low.includes('the messages below were generated by the user')) return true
      if (low.includes('local-command-stdout') || low.includes('<local-command-stdout>')) return true
      return false
    },
    isInterruptedByUser(text) {
      if (!text) return false
      const s = String(text).trim()
      return s === 'Request interrupted by user' || s.includes('Request interrupted by user')
    },
    isLongPreview(text) {
      if (!text) return false

      let weight = 0
      for (const ch of String(text)) {
        weight += WIDE_CHAR_RE.test(ch) ? 2 : 1
        if (weight > USER_PREVIEW_TRUNCATION_THRESHOLD) return true
      }

      return false
    },
    selectUser(u) {
      if (u && u.nonInteractive && !u.interruption) return
      this.selectedUser = u
      this.$nextTick(() => {
        // Scroll Users column (left side) to the selected user
        const userIndex = this.visibleUsers.findIndex(user => user.id === u.id)
        if (userIndex >= 0) {
          const leftScroll = document.querySelector('.left-scroll')
          const userItems = leftScroll?.querySelectorAll('.user-item')
          if (userItems && userItems[userIndex]) {
            userItems[userIndex].scrollIntoView({ behavior: 'instant', block: 'center' })
          }
        }

        // Scroll Conversation column (right side) to the message
        const id = `msg-${u.id}`
        const el = document.getElementById(id)
        if (!el) return

        // Highlight the user message element itself (or its internal card) so
        // bookmarks behave like left-side entries even if no assistant reply exists.
        const card = el.querySelector('.assistant-card') || el
        if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' })
        if (card) {
          card.classList.add('flash')
          setTimeout(() => card.classList.remove('flash'), 2600)
        }
      })
    }
      ,
    // removed legacy single-copy method; using copyText/copyRaw instead
    async copyText(a) {
      try {
        const txt = this.extractText(a.content)
        a._copiedText = true
        if (navigator.clipboard && navigator.clipboard.writeText) {
          try { await navigator.clipboard.writeText(txt) } catch (err) { this.fallbackCopyTextToClipboard(txt) }
        } else this.fallbackCopyTextToClipboard(txt)
      } catch (e) { console.error('copyText failed', e); a._copiedText = false }
      finally { setTimeout(() => { a._copiedText = false }, 1500) }
    },
    async copyRaw(a) {
      try {
        const raw = a.raw || a.content || a
        const txt = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)
        a._copiedRaw = true
        if (navigator.clipboard && navigator.clipboard.writeText) {
          try { await navigator.clipboard.writeText(txt) } catch (err) { this.fallbackCopyTextToClipboard(txt) }
        } else this.fallbackCopyTextToClipboard(txt)
      } catch (e) { console.error('copyRaw failed', e); a._copiedRaw = false }
      finally { setTimeout(() => { a._copiedRaw = false }, 1500) }
    },
    extractText(c) {
      if (!c) return ''
      if (typeof c === 'string') return c
      if (Array.isArray(c)) return c.map(item => this.extractText(item)).join('\n')
      if (typeof c === 'object') {
        if (c.toolUseResult) {
          const toolUseResultText = extractPlainText(c.toolUseResult.content ?? c.content)
          if (toolUseResultText) return toolUseResultText
        }
        if (c.text) return c.text
        if (c.content && typeof c.content === 'string') return c.content
        // ExitPlanMode: extract the plan text
    // thinking block: extract the thinking text
    if (c.type === 'thinking') {
      return extractPlainText(c)
    }
        // Grep tool: extract readable search summary
        if (c.name === 'Grep' || c.toolName === 'Grep' || (c.message && c.message.name === 'Grep')) {
          const pattern = (c.input && c.input.pattern) || ''
          const path = (c.input && c.input.path) || ''
          const glob = (c.input && c.input.glob) || ''
          const type = (c.input && c.input.type) || ''
          let parts = []
          if (pattern) parts.push('pattern: "' + pattern + '"')
          if (glob) parts.push('glob: "' + glob + '"')
          if (type) parts.push('type: ' + type)
          if (path) parts.push('path: ' + path)
          return parts.join(', ')
        }
        // Write tool: copy markdown source text for markdown files
        if (c.name === 'Write' || c.toolName === 'Write' || (c.message && c.message.name === 'Write')) {
          const message = c.message || {}
          const input = c.input || message.input || {}
          const filePath = input.file_path || input.filePath || input.path || c.file_path || c.filePath || c.path || message.file_path || message.filePath || message.path || ''
          const rawContent = input.content ?? message.content ?? ''
          const isMarkdownFile = typeof filePath === 'string' && /\.md$/i.test(filePath.trim())

          if (isMarkdownFile) {
            if (typeof rawContent === 'string') return rawContent
            if (rawContent == null) return ''
            return typeof rawContent === 'object' ? JSON.stringify(rawContent, null, 2) : String(rawContent)
          }

          if (typeof rawContent === 'string' && rawContent) return rawContent
          if (rawContent != null && typeof rawContent === 'object') return JSON.stringify(rawContent, null, 2)
          return filePath ? `Writing: ${filePath}` : ''
        }
        if (c.name === 'ExitPlanMode' || c.toolName === 'ExitPlanMode' || (c.message && c.message.name === 'ExitPlanMode')) {
          return (c.input && c.input.plan) || c.plan || ''
        }
        if (c.input && c.input.todos) return c.input.todos.map(t => (t.status ? `[${t.status}] ` : '') + (t.content||t.text||t.title||'')).join('\n')
        if (c.result && c.result.content) return typeof c.result.content === 'string' ? c.result.content : JSON.stringify(c.result.content)
        return extractPlainText(c)
      }
      return String(c)
    },
    // fallback copy method
    fallbackCopyTextToClipboard(text) {
      const textArea = document.createElement('textarea')
      textArea.value = text
      // Avoid scrolling to bottom
      textArea.style.top = '0'
      textArea.style.left = '0'
      textArea.style.position = 'fixed'
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()
      try {
        document.execCommand('copy')
      } catch (err) {
        console.error('fallback: Oops, unable to copy', err)
      }
      document.body.removeChild(textArea)
    },
    // preview/expand logic removed: assistant messages render fully by default
  }
}
</script>

<style>
.two-col { display: flex; gap: 12px; height: 100%; min-height: 0 }

.column-header {
  position: sticky;
  top: 0;
  z-index: 10;
  padding: 8px 0;
  margin: 0 0 8px 0;
  border-bottom: 2px solid #e5e7eb;
  font-size: 1rem;
  font-weight: 600;
}

.left {
  width: 320px;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #d1d5db;
  padding-right: 12px;
  margin-right: 12px;
}

.left-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding-right: 4px;
}

.left ul { padding: 0; margin: 0; list-style: none }
.left li { margin-right: 4px; }
.left li + li {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed rgba(15, 23, 42, 0.14);
}
.user-preview {
  position: relative;
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #eee;
  border-radius: 4px;
  box-sizing: border-box;
  background: white;
  line-height: 1.35;
}

.user-preview-button {
  appearance: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.user-preview-button:hover {
  background: #fafafa;
}

.user-preview-command {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Courier New', monospace;
  color: #4b5563;
}

.left li.selected .user-preview {
  background: rgba(37,99,235,0.08);
  border-color: rgba(37,99,235,0.12);
}

.user-preview-text {
  display: -webkit-box;
  overflow: hidden;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.user-preview-static {
  cursor: default;
}

.muted-entry {
  color: #666;
  font-style: italic;
  background: #fbfbfb;
  border-color: #f0f0f0;
}

.user-preview-truncated {
  padding-right: 28px;
}

.user-preview-more {
  position: absolute;
  right: 10px;
  bottom: 8px;
  padding-left: 6px;
  color: #6b7280;
  background: inherit;
  line-height: 1;
}

.right {
  flex: 1;
  min-width: 0;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.right-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding-right: 8px;
}

.right ul { padding: 0; margin: 0; list-style: none }
.right li { margin-right: 0; }
pre { white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; margin: 0; }

/* paragraph-style message rhythm */
.assistant-item {
  position: relative;
  margin: 0;
  padding: 2px 0;
}

.right ul li.assistant-item + li.assistant-item {
  margin-top: 6px;
  padding-top: 6px;
}

.right ul li.assistant-item + li.assistant-item::before {
  content: '';
  position: absolute;
  top: 0;
  left: 12px;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, rgba(231, 229, 228, 0.9), rgba(231, 229, 228, 0));
}

/* paragraph-style message container with copy controls */
.assistant-card {
  position: relative;
  min-width: 0;
  padding: 4px 0 4px 14px;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
}

.assistant-card::before {
  content: '';
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 0;
  width: 2px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.24);
}

.assistant-card.with-toolbar {
  padding-right: 54px;
}

.assistant-full { min-width: 0; }
.assistant-toolbar { position: absolute; top: 3px; right: 0; z-index: 2; }
.assistant-item[data-display="user"] .assistant-card::before { background: rgba(59, 130, 246, 0.34); }
.assistant-item[data-display="assistant"] .assistant-card::before { background: rgba(148, 163, 184, 0.24); }
.assistant-item.compact-entry .assistant-card {
  padding-top: 2px;
  padding-bottom: 2px;
}
.assistant-item.compact-entry .assistant-full > .message-renderer { line-height: 1.25; }

.assistant-card .message-renderer {
  line-height: 1.42;
}

.assistant-card .message-renderer :where(p, ul, ol, pre, blockquote, table, hr) {
  margin-block: 0.35rem;
}

.assistant-card .message-renderer :where(ul, ol) {
  padding-left: 1.15rem;
}

.assistant-card .message-renderer li {
  margin: 0.1rem 0;
}

.copy-btn { background: rgba(255,255,255,0.02); color: inherit; padding: 6px; border-radius: 6px }
.copy-btn:hover { background: rgba(255,255,255,0.04) }
.copy-btn.copied { background: rgba(52,211,153,0.16); color: var(--success) }

.copy-group .copy-btn {
  position: relative;
  top: 0;
  right: 0;
  width: 22px;
  height: 22px;
  min-width: 22px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(245, 243, 240, 0.92);
  box-sizing: border-box;
  box-shadow: 0 1px 2px rgba(28, 25, 23, 0.04);
}

.copy-group .copy-btn:hover {
  background: rgba(255, 255, 255, 0.98);
  border-color: rgba(148, 163, 184, 0.34);
}

.copy-group { display: flex; align-items: center; gap: 6px; opacity: 0; transform: translateY(-2px); transition: opacity 150ms ease, transform 150ms ease; pointer-events: none }
.assistant-item:hover .copy-group, .assistant-item:focus-within .copy-group, .copy-group:focus-within { opacity: 1; transform: translateY(0); pointer-events: auto }
.assistant-card.muted {
  opacity: 0.72;
  background: transparent;
}
.assistant-card.muted::before {
  background: rgba(168, 162, 158, 0.34);
}
.muted-note { color: #666; font-style: italic; margin-top: 4px; font-size: 13px }
.flash { animation: flash-bg 1.8s ease-in-out }
@keyframes flash-bg {
  0% {
    background: rgba(37, 99, 235, 0.08);
    box-shadow: inset 3px 0 0 rgba(37, 99, 235, 0.35);
  }
  70% {
    background: transparent;
    box-shadow: none;
  }
  100% {
    background: transparent;
    box-shadow: none;
  }
}
</style>
