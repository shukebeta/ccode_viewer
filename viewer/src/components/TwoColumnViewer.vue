<template>
  <div class="two-col">
    <div class="left">
      <h3 class="column-header">Users</h3>
      <div class="left-scroll">
        <div v-if="loading">Loading...</div>
        <ul v-else>
          <li v-for="u in users" :key="u.id" class="user-item" :class="{ selected: selectedUser && selectedUser.id === u.id }">
            <template v-if="u.nonInteractive">
              <div class="user-preview muted-entry">{{ u.preview }}</div>
            </template>
            <template v-else>
              <button class="user-preview" @click="selectUser(u)">
                <MessageRenderer :content="u.content || u.preview || ''" :disableImagePreview="true" />
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
  <li v-for="(m, idx) in allMessages" :key="m.id || idx" :id="`msg-${m.id || idx}`" class="assistant-item" :class="{ 'flash': m._flash }" :data-display="m.displayType">
            <div class="assistant-card card" :class="{ muted: m.muted }" style="position:relative">
            <div class="assistant-full">
              <div class="copy-group">
                <button class="copy-btn text-copy" :class="{ copied: m._copiedText }" @click.prevent="copyText(m)" :title="m._copiedText ? 'Copied text' : 'Copy text'">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><rect x="8" y="3" width="13" height="13" rx="2" ry="2"/></svg>
                </button>
                <button class="copy-btn raw-copy" :class="{ copied: m._copiedRaw }" @click.prevent="copyRaw(m)" :title="m._copiedRaw ? 'Copied raw' : 'Copy source JSON'">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16 20V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v14"/></svg>
                </button>
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

export default {
  components: { MessageRenderer },
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
  async mounted() { await this.load() },
  watch: {
    file: { immediate: true, handler() { this.load() } },
    highlightUserId: {
      handler(userId) {
        if (userId && this.users.length > 0) {
          // Find and select the user
          const user = this.users.find(u => u.id === userId)
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
          const user = this.users.find(u => u.id === this.highlightUserId)
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
        // process users: remove skippable and mark interruptions/commands as nonInteractive
        this.users = (rawUsers || []).map(u => {
          const txt = this.extractText(u.content || u.preview || '')
          if (this.isSkippable(txt)) return null
          const out = Object.assign({}, u)
          // interruption
          if (this.isInterruptedByUser(txt)) {
            out.interruption = true
            out.preview = '- user interruption -'
            out.nonInteractive = true
          } else {
            // command messages
            const cm = String(txt).match(/<command-message>(.*?)<\/command-message>/i) || String(txt).match(/<command-name>(.*?)<\/command-name>/i)
            if (cm && cm[1]) {
              const cmd = cm[1].trim()
              out.command = cmd
              out.preview = `command: ${cmd.startsWith('/') ? cmd : '/' + cmd}`
              out.nonInteractive = true
            }
          }
          return out
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
        const user = this.users.find(u => u.id === this.highlightUserId)
        if (user) {
          this.$nextTick(() => {
            this.selectUser(user)
          })
        }
      }
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

      // If message type indicates a tool, treat as assistant
      if (type === 'tool_use' || type === 'tool_result' || type === 'tool') type = 'assistant'
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

  const content = (m.message && (m.message.content || m.message)) || m.content || m
  const flatText = this.extractText(content)

  // Skip unhelpful messages: Caveat hints and raw local-command stdout
  if (this.isSkippable(flatText)) return

      // If rawType starts with 'tool', force assistant
      if (typeof rawType === 'string' && rawType.startsWith('tool')) type = 'assistant'

      if (type === 'user') {
        const previewRaw = (typeof content === 'string' ? content : JSON.stringify(content))
        const preview = previewRaw.substring(0,200)
        const userObj = { id, preview, content, timestamp: m.timestamp }
        // detect interruptions and command messages
        if (this.isInterruptedByUser(previewRaw)) {
          userObj.interruption = true
          // show a clean single-line preview
          userObj.preview = '- user interruption -'
          userObj.nonInteractive = true
        } else {
          // detect command-message markup
          const cm = String(previewRaw).match(/<command-message>(.*?)<\/command-message>/i) || String(previewRaw).match(/<command-name>(.*?)<\/command-name>/i)
          if (cm && cm[1]) {
            const cmd = cm[1].trim()
            userObj.command = cmd
            userObj.preview = `command: ${cmd.startsWith('/') ? cmd : '/' + cmd}`
            userObj.nonInteractive = true
          }
        }
        this.users.push(userObj)
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
        out.push(Object.assign({ displayType: 'user', content: ucontent }, u))
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
    selectUser(u) {
      if (u && u.nonInteractive) return
      this.selectedUser = u
      this.$nextTick(() => {
        // Scroll Users column (left side) to the selected user
        const userIndex = this.users.findIndex(user => user.id === u.id)
        if (userIndex >= 0) {
          const leftScroll = document.querySelector('.left-scroll')
          const userItems = leftScroll?.querySelectorAll('.user-item')
          if (userItems && userItems[userIndex]) {
            userItems[userIndex].scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }

        // Scroll Conversation column (right side) to the message
        const id = `msg-${u.id}`
        const el = document.getElementById(id)
        if (!el) return

        // Highlight the user message element itself (or its internal card) so
        // bookmarks behave like left-side entries even if no assistant reply exists.
        const card = el.querySelector('.assistant-card') || el
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
        if (c.text) return c.text
        if (c.content && typeof c.content === 'string') return c.content
        // ExitPlanMode: extract the plan text
    // thinking block: extract the thinking text
    if (c.type === 'thinking') {
      return c.thinking || ''
    }
        if (c.name === 'ExitPlanMode' || c.toolName === 'ExitPlanMode' || (c.message && c.message.name === 'ExitPlanMode')) {
          return (c.input && c.input.plan) || c.plan || ''
        }
        if (c.input && c.input.todos) return c.input.todos.map(t => (t.status ? `[${t.status}] ` : '') + (t.content||t.text||t.title||'')).join('\n')
        if (c.result && c.result.content) return typeof c.result.content === 'string' ? c.result.content : JSON.stringify(c.result.content)
        return JSON.stringify(c)
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
.left li { margin-bottom: 6px; margin-right: 4px; }
.left button { display: block; width: 100%; text-align: left; padding: 8px; border: 1px solid #eee; border-radius: 4px; background: white; box-sizing: border-box }
.left button:hover { background: #fafafa }
.left li.selected .user-preview { background: rgba(37,99,235,0.08); border-color: rgba(37,99,235,0.12) }
.muted-entry { color: #666; font-style: italic; padding: 6px 8px; border: 1px solid #f0f0f0; border-radius:4px; background: #fbfbfb; line-height:1.1; margin:4px 0 }

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
.right li { margin-right: 8px; }
pre { white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; margin: 0; }

/* compact dashed separator between assistant replies */
.right ul li.assistant-item { padding-top: 6px; }
.right ul li.assistant-item + li.assistant-item { border-top: 1px dashed rgba(15,23,36,0.06); margin-top: 6px; padding-top: 6px; }

/* assistant card copy button */
.assistant-card { padding: 34px 8px 8px 8px; position: relative }
/* Distinguish user and assistant messages with different backgrounds */
.assistant-item[data-display="user"] .assistant-card { background: rgba(59, 130, 246, 0.04); border-left: 3px solid rgba(59, 130, 246, 0.3); }
.assistant-item[data-display="assistant"] .assistant-card { background: rgba(255, 255, 255, 0.02); }
.copy-btn { display: inline-flex; align-items: center; justify-content: center; border: none; background: rgba(255,255,255,0.02); color: inherit; padding:6px; border-radius:6px; cursor:pointer }
.copy-btn svg { display:block }
.copy-btn:hover { background: rgba(255,255,255,0.04) }
.copy-btn.copied { background: rgba(52,211,153,0.16); color: var(--success) }

.copy-group .copy-btn { position: relative; top: 0; right: 0; padding:4px; border-radius:6px; background: rgba(255,255,255,0.02) }
.copy-group .copy-btn svg { width:12px; height:12px }
.copy-group .copy-btn:hover { background: rgba(255,255,255,0.04) }
.copy-group { position: absolute; top: 6px; right: 8px; display: flex; gap: 6px; opacity: 0; transform: translateY(-4px); transition: opacity 150ms ease, transform 150ms ease; z-index: 3 }
.assistant-item:hover .copy-group, .assistant-card:hover .copy-group { opacity: 1; transform: translateY(0) }
.assistant-card { padding: 34px 8px 8px 8px; position: relative }
.assistant-card.muted { opacity: 0.7; background: #f3f4f6 }
.muted-note { color: #666; font-style: italic; margin-top: 6px; font-size: 13px }
.flash { animation: flash-bg 2.2s ease-in-out }
@keyframes flash-bg { 0% { background: rgba(99,102,241,0.18) } 60% { background: transparent } 100% { background: transparent } }
</style>
