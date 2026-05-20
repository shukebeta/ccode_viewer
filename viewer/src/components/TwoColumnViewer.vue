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
      <div class="right-scroll" ref="rightScroll" @copy="handleConversationCopy">
        <div v-if="visibleAllMessages.length === 0">No messages</div>
        <ul>
  <li
    v-for="(m, idx) in visibleAllMessages"
    :key="m.id || idx"
    :id="`msg-${m.id || idx}`"
    class="assistant-item"
    :class="{ 'flash': m._flash, 'compact-entry': m._compactDisplay, 'highlighted': m.id === highlightedMessageId }"
    :data-display="m.displayType"
  >
            <div class="assistant-card card" :class="{ muted: m.muted, 'with-toolbar': !m._noCopy }">
            <div class="assistant-full">
              <div v-if="!m._noCopy" class="assistant-toolbar">
                <div class="copy-group">
                  <ActionIconButton class="copy-btn text-copy" :class="{ copied: m._copiedText }" icon="copy" :active="m._copiedText" active-icon="check" label="Copy text" active-label="Copied text" @click.prevent="copyText(m)" />
                  <ActionIconButton class="copy-btn raw-copy" :class="{ copied: m._copiedRaw }" icon="document" :active="m._copiedRaw" active-icon="check" label="Copy source JSON" active-label="Copied raw" @click.prevent="copyRaw(m)" />
                </div>
              </div>
              <MessageRenderer :content="m.content" :showRawCopy="false" />
              <div v-if="m.muted" class="muted-note">- user interruption -</div>
            </div>
          </div>
        </li>
        </ul>
      </div>
      <button
        v-if="hasUnseenLiveContent"
        type="button"
        class="live-new-content-pill"
        aria-label="Jump to latest content"
        @click="jumpToLiveEdge"
      >↓ New content</button>
    </div>
  </div>
</template>

<script>
import MessageRenderer from './MessageRenderer.vue'
import ActionIconButton from './ActionIconButton.vue'
import '../../../shared/messageContent.js'
import '../../../shared/liveTurnModel.js'

const messageContentUtils = globalThis.__ccodeViewerMessageContentUtils

if (!messageContentUtils) {
  throw new Error('messageContent utilities failed to load')
}

const liveTurnModel = globalThis.__ccodeViewerLiveTurnModel

if (!liveTurnModel) {
  throw new Error('liveTurnModel failed to load')
}

const { extractPlainText, getUserPreviewText, hasUserVisibleContent } = messageContentUtils
const { mergeIntegratedMessage } = liveTurnModel
import { AUTO_SELECT_FIRST_USER_ID } from '../constants'

const WIDE_CHAR_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF01-\uFF60\uFFE0-\uFFE6]/
const USER_PREVIEW_TRUNCATION_THRESHOLD = 120
const HIDDEN_ASSISTANT_BLOCK_TYPES = new Set(['permission-mode', 'last-prompt', 'ai-title', 'skill_listing'])
const HIDDEN_ASSISTANT_TOOL_NAMES = new Set(['ReportIntent', 'report_intent'])
const TOOL_LIKE_BLOCK_TYPES = new Set(['tool_use', 'tool_result', 'tool', 'status'])

export default {
  components: { MessageRenderer, ActionIconButton },
  props: {
    file: { type: String, default: null },
    sessionSource: { type: String, default: null },
    highlightUserId: { type: String, default: null },
    liveModeEnabled: { type: Boolean, default: true }
  },
  data() {
    return {
      users: [],
      mapping: {},
      allMessages: [],
      loading: false,
      selectedUser: null,
      highlightedMessageId: null,
      es: null,
      sessionCache: new Map(), // Cache for session data
      hasUnseenLiveContent: false,
      isAtLiveEdge: true
    }
  },
  computed: {
    visibleUsers() {
      return this.users.filter(u => !u.hideFromUsers)
    },
    visibleAllMessages() {
      return this.allMessages.filter(message => this.shouldRenderMessage(message))
    }
  },
  beforeUnmount() {
    this.cleanupEventSource()
    this.detachScrollListener()
  },
  watch: {
    file: { immediate: true, handler() { this.load() } },
    sessionSource() {
      if (this.file) this.setupEventSource()
    },
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
    },
    liveModeEnabled(newVal, oldVal) {
      if (newVal && !oldVal && this.file) {
        this.$nextTick(() => this.jumpToLiveEdge())
      }
    }
  },
  methods: {
    async load() {
      if (!this.file) return

      this.resetLiveViewportState()

      // Check cache first
      if (this.sessionCache.has(this.file)) {
        console.log('[TwoCol] Cache HIT for', this.file)
        const cached = this.sessionCache.get(this.file)
        this.users = cached.users
        this.mapping = cached.mapping
        this.selectedUser = null
        this.highlightedMessageId = null
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
        this.$nextTick(() => {
          this.attachScrollListener()
          this.updateIsAtLiveEdge()
        })
        return
      }

      this.loading = true
      console.log('[TwoCol] Cache MISS, fetching...', this.file)
      const fetchStart = performance.now()
      try {
        const res = await fetch('/api/session-mapping?file=' + encodeURIComponent(this.file))
        const json = await res.json()
        console.log('[TwoCol] Fetch took', (performance.now() - fetchStart).toFixed(0), 'ms')
        // Clean initial users/mapping: drop noise-wrapper entries (backend-flagged) and mark interruptions
        const rawUsers = json.users || []
        const rawMapping = json.mapping || {}
        // process users: drop noise wrappers and decorate command/interruption entries
        this.users = (rawUsers || []).map(u => {
          if (u && u.isNoiseWrapper) return null
          return this.decorateUser(u)
        }).filter(Boolean)
        // process mapping arrays
        const cleaned = {}
        for (const [k, arr] of Object.entries(rawMapping)) {
          const kept = (arr || []).filter(item => !(item && item.isNoiseWrapper)).map(item => {
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
  this.highlightedMessageId = null

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

      this.$nextTick(() => {
        this.attachScrollListener()
        this.updateIsAtLiveEdge()
      })
    },
    resetLiveViewportState() {
      this.hasUnseenLiveContent = false
      this.isAtLiveEdge = true
    },
    resolveHighlightedUser(userId) {
      if (!userId || this.visibleUsers.length === 0) return null
      if (userId === AUTO_SELECT_FIRST_USER_ID) return this.visibleUsers[0] || null
      return this.visibleUsers.find(u => u.id === userId) || null
    },
    setupEventSource() {
      this.cleanupEventSource()
      try {
        const params = new URLSearchParams({ file: this.file })
        if (this.sessionSource) params.set('source', this.sessionSource)
        this.es = new EventSource('/api/events?' + params.toString())
        this.es.addEventListener('session_appended', (ev) => {
          try {
            const d = JSON.parse(ev.data)
            const m = JSON.parse(d.line)
            const shouldAutoScroll = this.liveModeEnabled && this.isAtLiveEdge
            const result = this.integrateMessage(m)
            if (!result || result.kind === 'drop') return

            this.sessionCache.set(this.file, {
              users: this.users,
              mapping: this.mapping
            })

            this.$nextTick(() => {
              if (shouldAutoScroll) {
                this.scrollRightToBottom()
              } else {
                this.hasUnseenLiveContent = true
              }
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
      const wasAtEdgeBeforeMerge = this.isAtLiveEdge
      const result = mergeIntegratedMessage(
        { users: this.users, mapping: this.mapping },
        m
      )

      if (result.kind === 'drop') return result

      if (result.kind === 'append-user') {
        const idx = this.users.length - 1
        if (idx >= 0) {
          const bare = this.users[idx]
          const renderable = this.getRenderableContent(bare.raw || bare)
          const decorated = this.decorateUser({
            id: bare.id,
            content: renderable,
            timestamp: bare.timestamp
          })
          this.users.splice(idx, 1, decorated)
        }
      } else if (result.kind === 'append-assistant') {
        const bucket = this.mapping[result.userId]
        if (bucket && bucket.length) {
          const last = bucket[bucket.length - 1]
          last.content = this.getRenderableContent(last.raw || { content: last.content })
          const flatText = this.extractText(last.content)
          if (this.isInterruptedByUser(flatText)) {
            last.muted = true
            last._noCopy = true
          }
        }
      }

      this.rebuildAllMessages()

      if (result.kind === 'append-user' && !wasAtEdgeBeforeMerge) {
        this.$nextTick(() => {
          const target = this.allMessages.find(am => am.displayType === 'user' && am.id === result.userId)
          if (target) {
            target._flash = true
            setTimeout(() => { target._flash = false }, 1800)
          }
        })
      }

      return result
    },
    attachScrollListener() {
      const el = this.$refs.rightScroll
      if (!el) return
      if (this._scrollListenerEl === el) return
      this.detachScrollListener()
      this._scrollListenerEl = el
      this._scrollRafPending = false
      this._scrollHandler = () => {
        if (this._scrollRafPending) return
        this._scrollRafPending = true
        requestAnimationFrame(() => {
          this._scrollRafPending = false
          this.updateIsAtLiveEdge()
        })
      }
      el.addEventListener('scroll', this._scrollHandler, { passive: true })
    },
    detachScrollListener() {
      if (this._scrollListenerEl && this._scrollHandler) {
        try { this._scrollListenerEl.removeEventListener('scroll', this._scrollHandler) } catch (e) {}
      }
      this._scrollListenerEl = null
      this._scrollHandler = null
      this._scrollRafPending = false
    },
    updateIsAtLiveEdge() {
      const el = this.$refs.rightScroll
      if (!el) return
      const slack = Math.max(64, el.clientHeight * 0.05)
      const wasAtEdge = this.isAtLiveEdge
      this.isAtLiveEdge = (el.scrollHeight - el.scrollTop - el.clientHeight) <= slack
      if (!wasAtEdge && this.isAtLiveEdge) {
        this.hasUnseenLiveContent = false
      }
    },
    scrollRightToBottom() {
      const el = this.$refs.rightScroll
      if (!el) return
      el.scrollTop = el.scrollHeight
    },
    jumpToLiveEdge() {
      this.scrollRightToBottom()
      this.hasUnseenLiveContent = false
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
    getAssistantBlocks(content) {
      if (Array.isArray(content)) return content.filter(block => block != null)
      if (content == null || content === '') return []
      return [content]
    },
    getRawCopySources(raw) {
      if (Array.isArray(raw?.content)) return raw.content
      if (Array.isArray(raw?.message?.content)) return raw.message.content
      if (raw == null) return []
      return [raw]
    },
    isToolLikeAssistantBlock(content) {
      if (!content || typeof content !== 'object') return false
      if (content.toolUseResult) return true

      const type = content.type || (content.message && content.message.type) || null
      const toolName = content._copilotToolName || content.toolName || content.name || (content.message && content.message.name) || null

      if (type === 'thinking') return false
      if (TOOL_LIKE_BLOCK_TYPES.has(type)) return true
      return Boolean(toolName)
    },
    isToolOnlyAssistantContent(content) {
      const blocks = this.getAssistantBlocks(content).filter(block => this.hasRenderableAssistantContent(block))
      return blocks.length > 0 && blocks.every(block => this.isToolLikeAssistantBlock(block))
    },
    mergeAssistantContent(baseContent, extraBlocks) {
      const baseBlocks = this.getAssistantBlocks(baseContent)
      const merged = [...baseBlocks, ...extraBlocks]
      if (merged.length === 0) return ''
      if (merged.length === 1) return merged[0]
      return merged
    },
    mergeRawSources(baseRaw, extraRaw) {
      const merged = [...this.getRawCopySources(baseRaw), ...this.getRawCopySources(extraRaw)]
      if (merged.length === 0) return null
      if (merged.length === 1) return merged[0]
      return merged
    },
    createAssistantEntry(message, contentOverride = undefined, rawOverride = undefined) {
      const content = contentOverride === undefined
        ? (message.content || message.preview || (message.raw ? (typeof message.raw === 'string' ? message.raw : JSON.stringify(message.raw)) : ''))
        : contentOverride
      const raw = rawOverride === undefined ? message.raw : rawOverride

      return Object.assign({
        displayType: 'assistant',
        content,
        raw,
        _compactDisplay: this.isToolOnlyAssistantContent(content)
      }, message)
    },
    appendAssistantEntry(out, message) {
      const content = message.content || message.preview || ''
      const row = this.createAssistantEntry(message, content, message.raw)

      if (!row._compactDisplay) {
        out.push(row)
        return
      }

      const toolBlocks = this.getAssistantBlocks(content).filter(block => this.hasRenderableAssistantContent(block))
      if (toolBlocks.length === 0) return

      const previous = out[out.length - 1]
      if (previous && previous.displayType === 'assistant' && !previous.muted) {
        previous.content = this.mergeAssistantContent(previous.content, toolBlocks)
        previous.raw = this.mergeRawSources(previous.raw, message.raw)
        previous._compactDisplay = this.isToolOnlyAssistantContent(previous.content)
        return
      }

      out.push(this.createAssistantEntry(message, { type: 'tool_group', items: toolBlocks }, this.getRawCopySources(message.raw)))
    },
    rebuildAllMessages() {
      const out = []
      // include any orphaned assistant messages first
      if (this.mapping['__no_user__']) {
        for (const a of this.mapping['__no_user__']) {
          this.appendAssistantEntry(out, a)
        }
      }
      for (const u of this.users) {
        const ucontent = u.content || u.preview || ''
        const isCompactDisplay = Boolean(u.isCommand || u.interruption)
        out.push(Object.assign({
          displayType: 'user',
          content: ucontent,
          _compactDisplay: isCompactDisplay,
          _noCopy: Boolean(u.interruption)
        }, u))
        const replies = this.mapping[u.id] || []
        for (const a of replies) {
          this.appendAssistantEntry(out, a)
        }
      }
      this.allMessages = out
    },
    shouldRenderMessage(message) {
      if (!message || message.displayType !== 'assistant') return true
      if (message.muted) return true
      return this.hasRenderableAssistantContent(message.content)
    },
    hasRenderableAssistantContent(content) {
      if (content == null) return false
      if (typeof content === 'string') return content.trim().length > 0
      if (Array.isArray(content)) return content.some(item => this.hasRenderableAssistantContent(item))
      if (typeof content !== 'object') return String(content).trim().length > 0

      if (content.toolUseResult) return true

      const type = content.type || (content.message && content.message.type) || null
      const toolName = content._copilotToolName || content.toolName || content.name || (content.message && content.message.name) || null
      if (HIDDEN_ASSISTANT_BLOCK_TYPES.has(type)) return false
      if (HIDDEN_ASSISTANT_TOOL_NAMES.has(toolName)) return false
      if (type === 'tool_group' && Array.isArray(content.items)) return content.items.some(item => this.hasRenderableAssistantContent(item))
      if (type === 'thinking') return Boolean(extractPlainText(content).trim())

      const text = this.extractText(content).trim()
      if (text) return true

      if (type === 'text' || type === 'message' || type === 'paragraph') return false
      if (Array.isArray(content.content)) return content.content.some(item => this.hasRenderableAssistantContent(item))
      if (content.message) return this.hasRenderableAssistantContent(content.message.content || content.message.text || content.message)
      if (content.result && content.result.content != null) return this.hasRenderableAssistantContent(content.result.content)

      return Object.keys(content).length > 0
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
      this.highlightedMessageId = u.id

      const targetMessage = this.allMessages.find(message => message.id === u.id)
      if (targetMessage) {
        targetMessage._flash = false
        this.$nextTick(() => {
          targetMessage._flash = true
          setTimeout(() => { targetMessage._flash = false }, 1800)
        })
      }

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
        if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' })
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
        const raw = a._rawCopySource ?? a.raw ?? a.content ?? a
        const txt = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)
        a._copiedRaw = true
        if (navigator.clipboard && navigator.clipboard.writeText) {
          try { await navigator.clipboard.writeText(txt) } catch (err) { this.fallbackCopyTextToClipboard(txt) }
        } else this.fallbackCopyTextToClipboard(txt)
      } catch (e) { console.error('copyRaw failed', e); a._copiedRaw = false }
      finally { setTimeout(() => { a._copiedRaw = false }, 1500) }
    },
    handleConversationCopy(event) {
      const container = event.currentTarget
      if (!(container instanceof Element) || !event.clipboardData) return

      const selection = window.getSelection ? window.getSelection() : null
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return

      const anchorNode = selection.anchorNode
      const focusNode = selection.focusNode
      if (!anchorNode || !focusNode || !container.contains(anchorNode) || !container.contains(focusNode)) return

      const wrapper = document.createElement('div')
      for (let index = 0; index < selection.rangeCount; index += 1) {
        wrapper.appendChild(selection.getRangeAt(index).cloneContents())
      }

      this.stripCopiedConversationUi(wrapper)

      const html = wrapper.innerHTML.trim()
      const text = selection.toString()
      if (!html && !text) return

      event.preventDefault()
      if (html) event.clipboardData.setData('text/html', html)
      if (text) event.clipboardData.setData('text/plain', text)
    },
    stripCopiedConversationUi(root) {
      root.querySelectorAll('.assistant-toolbar, .copy-group, .copy-btn, .collapsible-toggle').forEach((node) => {
        node.remove()
      })
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
        if (c.type === 'tool_group' && Array.isArray(c.items)) {
          return c.items.map(item => this.extractText(item)).filter(Boolean).join('\n')
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
  position: relative;
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

@media (max-width: 900px) {
  .two-col {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .left,
  .right {
    width: 100%;
    margin-right: 0;
    padding-right: 0;
    border-right: none;
  }

  .left {
    height: auto;
    max-height: 28vh;
    border-bottom: 1px solid #d1d5db;
    padding-bottom: 8px;
  }

  .right {
    min-height: 55vh;
  }

  .left-scroll,
  .right-scroll {
    padding-right: 0;
  }
}

/* paragraph-style message rhythm */
.assistant-item {
  position: relative;
  margin: 0;
  padding: 1px 0;
}

.right ul li.assistant-item + li.assistant-item {
  margin-top: 2px;
}

/* paragraph-style message container with copy controls */
.assistant-card,
.assistant-card.card {
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
.assistant-item.compact-entry .assistant-card.with-toolbar {
  padding-right: 42px;
}
.assistant-item.compact-entry .assistant-full > .message-renderer { line-height: 1.25; }
.assistant-item.compact-entry .assistant-toolbar {
  top: 1px;
}

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
.assistant-toolbar,
.copy-group,
.copy-btn {
  user-select: none;
  -webkit-user-select: none;
}
.assistant-card.muted {
  opacity: 0.72;
  background: transparent;
}
.assistant-card.muted::before {
  background: rgba(168, 162, 158, 0.34);
}
.muted-note { color: #666; font-style: italic; margin-top: 4px; font-size: 13px }
.assistant-item.flash .assistant-card { animation: flash-bg 1.8s ease-in-out }
@keyframes flash-bg {
  0% {
    background: rgba(37, 99, 235, 0.18);
    box-shadow: inset 3px 0 0 rgba(37, 99, 235, 0.55);
  }
  70% {
    background: rgba(37, 99, 235, 0.07);
    box-shadow: inset 3px 0 0 rgba(37, 99, 235, 0.55);
  }
  100% {
    background: rgba(37, 99, 235, 0.07);
    box-shadow: inset 3px 0 0 rgba(37, 99, 235, 0.55);
  }
}
.assistant-item.highlighted .assistant-card {
  background: rgba(37, 99, 235, 0.07);
  border-radius: 6px;
}
.assistant-item.highlighted .assistant-card::before {
  background: rgba(37, 99, 235, 0.7);
  width: 3px;
}
</style>
