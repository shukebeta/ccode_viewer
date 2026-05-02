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
              <span v-if="s.source && s.source !== 'claudecode'" :class="['source-badge', s.source]">
                {{ sourceLabel(s.source) }}
              </span>
              <span v-if="s.branches && s.branches.length" class="branch-badge">
                {{ s.branches.length === 1 ? s.branches[0] : s.branches.join(', ') }}
              </span>
            </div>
            <div class="session-preview">{{ shortPreview(s.preview || s.id) }}</div>
          </button>
          <button v-if="!isToday(s.lastTime || s.startTime)" class="delete-btn" @click="confirmDelete(s)" title="Delete session">×</button>
        </div>
      </li>
    </ul>
    </slot>
  </div>
</template>

<script>
import { ElMessageBox, ElMessage } from 'element-plus'
export default {
  props: ['project', 'currentSessionFile'],
  data() { return { sessions: [], loading: false } },
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
      this.loading = true
      let sessions = []
      try {
        const res = await fetch('/api/sessions?project=' + encodeURIComponent(key))
        const json = await res.json()
        sessions = Array.isArray(json) ? json : []
        this.sessions = sessions
      } catch (e) {
        console.error(e)
        this.sessions = []
      }
      this.loading = false
      this.$emit('sessions-loaded', { projectKey: key, sessions: this.sessions })
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
      const labels = {
        claudecode: 'Claude',
        gcopilot: 'Copilot',
        codex: 'Codex'
      }
      return labels[src] || src
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
</style>
