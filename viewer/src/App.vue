<template>
  <div class="app-root">
    <h1>Claude Vite App</h1>
    <div class="layout">
      <div class="col projects-col">
        <Projects :selected="project" @select-project="onSelectProject" />
      </div>
      <main class="main">
        <div class="main-top">
          <details ref="sessionsDetails" open class="sessions-dropdown" v-if="project">
            <summary class="sessions-summary">
              <template v-if="$refs.sessionsDetails && !$refs.sessionsDetails.open && selectedSession">
                <div class="session-time">{{ formatTime(selectedSession.lastTime || selectedSession.startTime) }} <span class="muted">({{ selectedSession.messageCount }})</span></div>
                <div class="session-preview">{{ shortPreview(selectedSession.preview || selectedSession.id) }}</div>
              </template>
              <template v-else>
                {{ sessionFile ? sessionName : `Sessions for ${project.name}` }}
              </template>
            </summary>
            <Sessions :project="project" @select-session="onSelectSession" />
          </details>
          <div></div>
        </div>
        <TwoColumnViewer v-if="sessionFile" :file="sessionFile" />
        <div v-else class="placeholder">Select a session to view</div>
      </main>
    </div>
  </div>
</template>

<script>
import Projects from './components/Projects.vue'
import Sessions from './components/Sessions.vue'
import TwoColumnViewer from './components/TwoColumnViewer.vue'

export default {
  components: { Projects, Sessions, TwoColumnViewer },
  data() {
    return { project: null, sessionFile: null, selectedSession: null }
  },
  computed: {
    sessionName() {
      if (!this.sessionFile) return ''
      // show last segment of file path as friendly name
      const parts = (this.sessionFile || '').split('/')
      return parts[parts.length - 1]
    }
  },
  methods: {
    onSelectProject(p) {
      this.project = p
      this.sessionFile = null
    },
    onSelectSession(file, sessionObj) {
      this.sessionFile = file
      this.selectedSession = sessionObj || null
      // auto-close the sessions dropdown so it no longer occupies space
      try {
        const d = this.$refs.sessionsDetails
        if (d && typeof d.open !== 'undefined') d.open = false
      } catch (e) { /* ignore */ }
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
    }
  }
}
</script>

<style>
.app-root { display: flex; flex-direction: column; height: 100vh }
.app-root h1 { margin: 12px 16px }
.layout { display: flex; gap: 16px; flex: 1; min-height: 0 }
.col { padding: 8px; box-sizing: border-box; min-height: 0 }
.projects-col { width: 260px; border-right: 1px solid rgba(2,6,23,0.04); background: linear-gradient(180deg, rgba(250,250,252,0.8), rgba(244,247,250,0.6)); }
.main { flex: 1; padding-left: 12px; min-width: 0; min-height: 0; display: flex; flex-direction: column }
.main-top { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 8px }
.sessions-dropdown { width: 630px; background: var(--card); border: 1px solid #eee; border-radius: 6px; padding: 8px; margin-right: 12px; align-self: flex-start }
.sessions-summary { font-weight: 600; cursor: pointer; padding: 4px 0 }
.col, .main { overflow: auto }
.placeholder { color: #666 }
</style>
