<template>
  <div>
    <h3 class="sessions-header">Sessions</h3>
    <slot name="search"></slot>
    <slot name="searchResults">
      <div v-if="loading">Loading...</div>
      <ul v-else class="sessions-list">
      <li v-for="s in sessions" :key="s.filePath" class="session-item">
        <div class="session-row">
          <button
            class="session-card"
            :class="{
              active: s.filePath === currentSessionFile,
              'main-session': !s.isAgent,
              'agent-session': s.isAgent
            }"
            @click="$emit('select-session', s.filePath, s)"
          >
            <div class="session-time">
              {{ formatTime(s.lastTime || s.startTime) }}
              <span class="muted">({{ s.messageCount }})</span>
              <span
                v-if="s.source"
                :class="['source-badge', 'session-source-badge', s.source]"
                :title="sourceLabel(s.source)"
                :aria-label="sourceLabel(s.source)"
              >
                <svg
                  v-if="s.source === 'claudecode'"
                  class="source-icon"
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M8 1.5 9.35 5.1 13 6.45 9.35 7.8 8 11.4 6.65 7.8 3 6.45 6.65 5.1 8 1.5Z"
                    fill="currentColor"
                  />
                  <path
                    d="M12.2 10.4 12.8 12 14.4 12.6 12.8 13.2 12.2 14.8 11.6 13.2 10 12.6 11.6 12 12.2 10.4Z"
                    fill="currentColor"
                    opacity="0.72"
                  />
                </svg>
                <svg
                  v-else-if="s.source === 'gcopilot'"
                  class="source-icon"
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M5 11.75h6.25A2.75 2.75 0 0 0 14 9V7.25A3.75 3.75 0 0 0 10.25 3.5h-.55A3.25 3.25 0 0 0 3.5 4.55 2.75 2.75 0 0 0 2 7v2a2.75 2.75 0 0 0 3 2.75Z"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M5.75 8h.01M10.25 8h.01M6.5 11.75v1.1M9.5 11.75v1.1"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linecap="round"
                  />
                </svg>
                <svg
                  v-else-if="s.source === 'codex'"
                  class="source-icon"
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M6 3.25 2.75 8 6 12.75M10 3.25 13.25 8 10 12.75"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M6.8 13.25h2.4"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                  />
                </svg>
                <span v-else class="source-fallback" aria-hidden="true">
                  {{ sourceLabel(s.source).slice(0, 1) }}
                </span>
              </span>
              <span v-if="s.branches && s.branches.length" class="branch-badge">
                {{ s.branches.length === 1 ? s.branches[0] : s.branches.join(', ') }}
              </span>
            </div>
            <div class="session-preview">{{ shortPreview(s.preview || s.id) }}</div>
          </button>
          <div class="session-actions">
            <button
              type="button"
              class="copy-cmd-btn"
              :class="{ copied: !!s._copiedCmd }"
              :title="`Copy: ${buildResumeCommand(s)}`"
              :aria-label="`Copy resume command for ${sourceLabel(s.source || 'claudecode')} session`"
              @click="copyResumeCommand(s)"
            >
              <svg v-if="s._copiedCmd" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
            <button v-if="!isToday(s.lastTime || s.startTime)" class="delete-btn" @click="confirmDelete(s)" title="Delete session">×</button>
          </div>
        </div>
      </li>
    </ul>
    </slot>
  </div>
</template>

<script>
import { ElMessageBox, ElMessage } from 'element-plus'
import { SOURCE_LABELS } from '../constants.js'
export default {
  props: ['project', 'currentSessionFile'],
  data() {
    return {
      sessions: [],
      loading: false,
      loadRequestId: 0,
      loadAbortController: null
    }
  },
  mounted() {
    // Scroll to active session on mount (when returning from search)
    if (this.currentSessionFile) {
      this.$nextTick(() => {
        setTimeout(() => {
          const activeButton = document.querySelector('.session-card.active')
          if (activeButton) {
            activeButton.scrollIntoView({ behavior: 'instant', block: 'center' })
          }
        }, 100)
      })
    }
  },
  beforeUnmount() {
    if (this.loadAbortController) {
      this.loadAbortController.abort()
      this.loadAbortController = null
    }
  },
  watch: {
    project: {
      immediate: true,
      handler() { this.load() }
    }
  },
  methods: {
    async load() {
      if (!this.project) return

      const key = this.project.id || this.project.name
      const requestId = ++this.loadRequestId
      if (this.loadAbortController) {
        this.loadAbortController.abort()
      }
      const controller = new AbortController()
      this.loadAbortController = controller
      this.loading = true
      let sessions = []
      try {
        const res = await fetch('/api/sessions?project=' + encodeURIComponent(key), {
          signal: controller.signal
        })
        const json = await res.json()
        if (requestId !== this.loadRequestId) return
        sessions = Array.isArray(json) ? json : []
        this.sessions = sessions
      } catch (e) {
        if (e && e.name === 'AbortError') return
        console.error(e)
        if (requestId === this.loadRequestId) {
          this.sessions = []
        }
      } finally {
        if (requestId === this.loadRequestId) {
          this.loading = false
          if (this.loadAbortController === controller) {
            this.loadAbortController = null
          }
          this.$emit('sessions-loaded', { projectKey: key, sessions: this.sessions })
        }
      }
    }
    , formatTime(ts) {
      if (!ts) return ''
      try {
        const d = new Date(ts)
        if (isNaN(d.getTime())) return ts
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        const hh = String(d.getHours()).padStart(2, '0')
        const mm = String(d.getMinutes()).padStart(2, '0')
        const ss = String(d.getSeconds()).padStart(2, '0')
        return `${y}-${m}-${day} ${hh}:${mm}:${ss}`
      } catch (e) { return ts }
    },
    shortPreview(txt) {
      if (!txt) return ''
      const s = String(txt).replace(/\s+/g, ' ').trim()
      return s.length > 50 ? s.slice(0,50) + '...' : s
    },
    isToday(ts) {
      if (!ts) return false
      try {
        const d = new Date(ts)
        const today = new Date()
        return d.getFullYear() === today.getFullYear() &&
               d.getMonth() === today.getMonth() &&
               d.getDate() === today.getDate()
      } catch (e) { return false }
    },
    async confirmDelete(session) {
      const timeStr = this.formatTime(session.startTime)
      const msg = timeStr 
        ? 'Delete session from ' + timeStr + '?'
        : 'Delete this empty session?'
      try {
        await ElMessageBox.confirm(msg, 'Confirm Delete', {
          confirmButtonText: 'Delete',
          cancelButtonText: 'Cancel',
          type: 'warning'
        })
        this.deleteSession(session)
      } catch (e) {
        // User cancelled
      }
    },
    async deleteSession(session) {
      try {
        const res = await fetch('/api/session?file=' + encodeURIComponent(session.filePath), {
          method: 'DELETE'
        })
        if (!res.ok) throw new Error('Delete failed')
        await this.load()
      } catch (e) {
        ElMessage.error('Failed to delete session: ' + e.message)
      }
    },
    sourceLabel(src) {
      return SOURCE_LABELS[src] || src
    },
    buildResumeCommand(s) {
      const id = (s && s.id) || ''
      const src = (s && s.source) || 'claudecode'
      switch (src) {
        case 'codex': return `codex resume ${id}`
        case 'gcopilot': return `copilot --resume=${id}`
        case 'claudecode':
        default: return `claude --resume ${id}`
      }
    },
    async copyResumeCommand(s) {
      const cmd = this.buildResumeCommand(s)
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(cmd)
        } else {
          const ta = document.createElement('textarea')
          ta.value = cmd
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
        }
        s._copiedCmd = true
        setTimeout(() => { s._copiedCmd = false }, 1500)
      } catch (e) {
        console.error('Failed to copy resume command', e)
        ElMessage.error('Failed to copy command')
      }
    }
  },
  computed: {
    displayProjectName() {
      if (!this.project || !this.project.name) return 'Sessions'
      const raw = this.project.name
      // If it's a path, show just the basename
      if (raw.includes('/') || raw.includes('\\')) {
        const parts = raw.split(/[\\\/]/).filter(Boolean)
        return parts.length ? parts[parts.length - 1] : raw
      }
      // Otherwise show raw name
      return raw
    }
  }
}
</script>

<style scoped>
.sessions-header {
  margin: 0 0 8px 0;
  padding: 8px var(--sp-3);
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 2px solid #e5e7eb;
}
.sessions-list { list-style:none; padding:0 var(--sp-3); margin:var(--sp-2) 0 }
.session-item { margin-bottom:var(--sp-1) }
.session-card {
  display: block;
  width: 100%;
  text-align: left;
  border: 1px solid var(--border);
  background: var(--card);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-md);
  transition: all var(--duration-fast) var(--ease-out);
  cursor: pointer;
}

.session-card:hover {
  background: var(--card-hover);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}

.session-card.active {
  background: var(--accent-muted);
  border-color: var(--accent);
  border-width: 2px;
  padding: 7px 11px;
  box-shadow: var(--shadow-md);
  font-weight: 600;
}

.session-time { font-weight:600; font-size:13px; margin-bottom:2px; color: var(--text); }
.session-preview { color: var(--text-secondary); font-size:13px; line-height: 1.35; }
.muted { color: var(--text-muted); font-size:12px; margin-left:var(--sp-1) }
.branch-badge {
  display: inline-block;
  background: var(--success-light);
  color: var(--success);
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  margin-left: var(--sp-1);
  font-weight: 500;
  font-family: var(--font-mono);
}

.session-source-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  margin-left: var(--sp-1);
  vertical-align: middle;
}

.source-icon {
  width: 13px;
  height: 13px;
  display: block;
}

.source-fallback {
  font-size: 10px;
  line-height: 1;
}
</style>
