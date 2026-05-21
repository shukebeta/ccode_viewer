<template>
  <div class="app-root">
    <div class="app-header">
      <div
        class="app-brand"
        :class="{ 'app-brand--interactive': isTauri }"
        :title="isTauri ? 'Rewind — Navigate and explore your AI coding sessions\n(Double-click to open in browser)' : undefined"
        @dblclick="openInBrowser"
        aria-label="Rewind"
      >
        <img class="app-brand-mark" src="/rewind-icon.svg" alt="" />
        <span class="app-brand-name">Rewind</span>
      </div>
      <ProjectSelector
        :selected="project"
        @select-project="onSelectProject"
        @projects-loaded="onProjectsLoaded"
      />
      <label class="live-mode-toggle" title="Auto-follow streaming output">
        <span class="live-mode-toggle-label">Live</span>
        <el-switch
          v-model="liveModeEnabled"
          aria-label="Live"
          @change="onLiveModeChange"
        />
      </label>
    </div>
    <div class="layout" :class="{ 'layout--session-active': mobileShowConversation }">
      <div class="sessions-panel" v-if="project">
        <Sessions
          :project="project"
          :currentSessionFile="sessionFile"
          @select-session="onSelectSession"
          @sessions-loaded="onSessionsLoaded"
        >
          <template #search>
            <SearchBox
              :resultCount="searchResults.length"
              :loading="searchLoading"
              @search="onSearch"
            />
          </template>
          <template #searchResults>
            <SearchResults
              v-if="searchQuery"
              :results="searchResults"
              :query="searchQuery"
              @select-result="onSelectSearchResult"
              @clear-search="clearSearch"
            />
          </template>
        </Sessions>
      </div>
      <main class="main-panel">
        <div v-if="sessionFile" class="mobile-session-actions">
          <button type="button" class="mobile-back-btn" @click="showSessionList">
            Back to sessions
          </button>
        </div>
        <TwoColumnViewer
          v-if="sessionFile"
          :file="sessionFile"
          :sessionSource="sessionSource"
          :highlightUserId="highlightUserId"
          :liveModeEnabled="liveModeEnabled"
        />
        <div v-else class="placeholder">
          {{ project ? 'Select a session to view' : 'Select a project to start' }}
        </div>
      </main>
    </div>
  </div>
</template>

<script>
import ProjectSelector from './components/ProjectSelector.vue'
import Sessions from './components/Sessions.vue'
import SearchBox from './components/SearchBox.vue'
import SearchResults from './components/SearchResults.vue'
import TwoColumnViewer from './components/TwoColumnViewer.vue'
import { AUTO_SELECT_FIRST_USER_ID } from './constants'
import { readHash, writeHash } from './lib/urlHash.js'

const LIVE_MODE_STORAGE_KEY = 'ccode_viewer:liveModeEnabled'

function readLiveModePreference() {
  if (typeof localStorage === 'undefined') return true
  try {
    return localStorage.getItem(LIVE_MODE_STORAGE_KEY) !== 'false'
  } catch (e) {
    return true
  }
}

export default {
  components: { ProjectSelector, Sessions, SearchBox, SearchResults, TwoColumnViewer },
  data() {
    const pendingHashRestore = (typeof window !== 'undefined') ? readHash() : null
    return {
      isTauri: typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__,
      project: pendingHashRestore
        ? { id: pendingHashRestore.project, name: pendingHashRestore.project }
        : null,
      sessionFile: null,
      selectedSession: null,
      // Search state
      searchQuery: '',
      searchResults: [],
      searchLoading: false,
      highlightUserId: null,
      sessionSource: pendingHashRestore ? pendingHashRestore.source : null,
      hasResolvedInitialProjectSelection: false,
      pendingInitialSessionSelection: !pendingHashRestore,
      pendingHashRestore,
      isCompactViewport: false,
      mobileShowConversation: false,
      liveModeEnabled: readLiveModePreference()
    }
  },
  mounted() {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      this._compactViewportQuery = window.matchMedia('(max-width: 900px)')
      this._handleViewportChange = (event) => {
        this.isCompactViewport = !!event.matches
        if (!this.isCompactViewport) this.mobileShowConversation = false
      }
      this.isCompactViewport = this._compactViewportQuery.matches
      if (typeof this._compactViewportQuery.addEventListener === 'function') {
        this._compactViewportQuery.addEventListener('change', this._handleViewportChange)
      } else if (typeof this._compactViewportQuery.addListener === 'function') {
        this._compactViewportQuery.addListener(this._handleViewportChange)
      }
    }

    if (this.isTauri) {
      this._f5Handler = (e) => {
        if (e.key === 'F5') {
          e.preventDefault()
          window.location.reload()
        }
      }
      document.addEventListener('keydown', this._f5Handler)
    }
  },
  beforeUnmount() {
    if (this._compactViewportQuery && this._handleViewportChange) {
      if (typeof this._compactViewportQuery.removeEventListener === 'function') {
        this._compactViewportQuery.removeEventListener('change', this._handleViewportChange)
      } else if (typeof this._compactViewportQuery.removeListener === 'function') {
        this._compactViewportQuery.removeListener(this._handleViewportChange)
      }
    }
    if (this._f5Handler) {
      document.removeEventListener('keydown', this._f5Handler)
    }
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
    openInBrowser() {
      if (!this.isTauri) return
      window.__TAURI_INTERNALS__.invoke('open_in_browser', { url: window.location.origin })
    },
    onProjectsLoaded(projects) {
      if (this.hasResolvedInitialProjectSelection) return

      this.hasResolvedInitialProjectSelection = true

      if (this.pendingHashRestore) {
        const real = Array.isArray(projects)
          ? projects.find(p => p.id === this.pendingHashRestore.project)
          : null
        if (real) {
          // Merge into the same object reference so Sessions.vue's project
          // watcher does not re-fire and trigger a duplicate /api/sessions fetch.
          Object.assign(this.project, real)
          return
        }
        // Stale project id — fall back to auto-select-first.
        this.pendingHashRestore = null
        this.sessionSource = null
        writeHash({})
        this.pendingInitialSessionSelection = true
        if (Array.isArray(projects) && projects.length > 0) {
          this.onSelectProject(projects[0], { autoInitial: true })
        } else {
          this.project = null
        }
        return
      }

      if (!this.project && Array.isArray(projects) && projects.length > 0) {
        this.onSelectProject(projects[0], { autoInitial: true })
      }
    },
    onSelectProject(p, options = {}) {
      // User-initiated project change aborts any pending hash restore.
      if (!options.autoInitial && this.pendingHashRestore) {
        this.pendingHashRestore = null
      }
      this.project = p
      this.sessionFile = null
      this.selectedSession = null
      this.sessionSource = null
      this.highlightUserId = null
      this.mobileShowConversation = false
      // Auto-select first session whenever project changes, unless there's an active search
      this.pendingInitialSessionSelection = true

      // If there's an active search query, re-trigger search in new project
      if (this.searchQuery && this.searchQuery.length >= 3) {
        this.pendingInitialSessionSelection = false
        this.onSearch(this.searchQuery)
      } else {
        this.clearSearch()
      }

      writeHash({ project: p && p.id })
    },
    selectFirstSession(sessions) {
      if (this.isCompactViewport) return
      if (this.searchQuery || this.sessionFile || !Array.isArray(sessions) || sessions.length === 0) return
      this.onSelectSession(sessions[0].filePath, sessions[0], { highlightFirstUser: true })
    },
    onSessionsLoaded({ projectKey, sessions }) {
      const currentProjectKey = this.project && (this.project.id || this.project.name)
      if (!currentProjectKey || projectKey !== currentProjectKey) return

      if (this.pendingHashRestore && this.pendingHashRestore.project === currentProjectKey) {
        const target = Array.isArray(sessions)
          ? sessions.find(s => s.id === this.pendingHashRestore.session)
          : null
        if (target) {
          this.pendingHashRestore = null
          this.onSelectSession(target.filePath, target, { highlightFirstUser: false })
          return
        }
        // Stale session id — strip from URL and fall back.
        this.pendingHashRestore = null
        writeHash({ project: currentProjectKey })
        this.selectFirstSession(sessions)
        return
      }

      if (!this.pendingInitialSessionSelection) return
      this.pendingInitialSessionSelection = false
      this.selectFirstSession(sessions)
    },
    onSelectSession(file, sessionObj, options = {}) {
      // User-initiated session change aborts any pending hash restore.
      if (this.pendingHashRestore && sessionObj?.id !== this.pendingHashRestore.session) {
        this.pendingHashRestore = null
      }
      this.sessionFile = file
      this.selectedSession = sessionObj || null
      this.sessionSource = sessionObj?.source || null
      this.highlightUserId = options.highlightFirstUser ? AUTO_SELECT_FIRST_USER_ID : null
      if (this.isCompactViewport) this.mobileShowConversation = true
      writeHash({
        project: this.project?.id,
        session: sessionObj?.id,
        source: this.sessionSource
      })
    },
    async onSearch(query) {
      this.searchQuery = query

      if (!query || query.length < 3) {
        this.searchResults = []
        return
      }

      if (!this.project) return

      this.searchLoading = true
      try {
        const projectId = encodeURIComponent(this.project.id || this.project.name)
        const res = await fetch(`/api/projects/${projectId}/search?q=${encodeURIComponent(query)}`)
        if (!res.ok) throw new Error('Search failed')
        this.searchResults = await res.json()
      } catch (e) {
        console.error('Search error:', e)
        this.searchResults = []
      } finally {
        this.searchLoading = false
      }
    },
    onSelectSearchResult({ sessionFile, source, userId, sessionId }) {
      // User-initiated selection aborts any pending hash restore.
      if (this.pendingHashRestore) this.pendingHashRestore = null
      // Load the session and highlight the user message
      this.pendingInitialSessionSelection = false
      this.highlightUserId = userId
      this.sessionFile = sessionFile
      this.selectedSession = null
      this.sessionSource = source || null
      if (this.isCompactViewport) this.mobileShowConversation = true
      writeHash({
        project: this.project?.id,
        session: sessionId,
        source: source || null
      })
    },
    showSessionList() {
      this.mobileShowConversation = false
      this.highlightUserId = null
    },
    clearSearch() {
      this.searchQuery = ''
      this.searchResults = []
      this.highlightUserId = null
    },
    onLiveModeChange(value) {
      if (typeof localStorage === 'undefined') return
      try {
        localStorage.setItem(LIVE_MODE_STORAGE_KEY, String(Boolean(value)))
      } catch (e) {
        // ignore quota / disabled storage
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
    }
  }
}
</script>

<style>
.app-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
}

.app-title {
  padding: var(--sp-2) var(--sp-4);
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
  background: var(--card);
}

.app-header {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-2) var(--sp-4);
  border-bottom: 1px solid var(--border);
  background: var(--card);
  height: var(--header-height);
  box-sizing: border-box;
}

.app-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  min-width: max-content;
}

.app-brand--interactive {
  cursor: pointer;
  user-select: none;
}

.app-brand-mark {
  width: 28px;
  height: 28px;
  display: block;
}

.app-brand-name {
  font-size: 0.98rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text);
}

.layout {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.sessions-panel {
  width: var(--sidebar-width);
  border-right: 1px solid var(--border);
  padding: 0;
  overflow-y: auto;
  background: var(--bg);
}

.main-panel {
  flex: 1;
  min-width: 0;
  padding: 0 var(--sp-4) var(--sp-4);
  overflow: auto;
  background: var(--bg);
}

.placeholder {
  color: var(--text-muted);
  text-align: center;
  padding: var(--sp-10) var(--sp-5);
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.mobile-session-actions {
  display: none;
}

.mobile-back-btn {
  appearance: none;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font: inherit;
  line-height: 1.2;
  cursor: pointer;
}

@media (max-width: 900px) {
  .app-header {
    padding: var(--sp-2) var(--sp-3);
    gap: var(--sp-3);
  }

  .layout {
    display: block;
    overflow: auto;
  }

  .sessions-panel,
  .main-panel {
    width: 100%;
    min-width: 0;
  }

  .sessions-panel {
    border-right: none;
  }

  .main-panel {
    display: none;
    padding: 0 var(--sp-3) var(--sp-3);
  }

  .layout.layout--session-active .sessions-panel {
    display: none;
  }

  .layout.layout--session-active .main-panel {
    display: block;
  }

  .mobile-session-actions {
    display: flex;
    justify-content: flex-start;
    padding: var(--sp-2) 0;
    position: sticky;
    top: 0;
    z-index: 20;
    background: var(--bg);
  }
}
</style>
