<template>
  <div class="app-root">
    <div class="app-header">
      <div class="app-brand" aria-label="Rewind">
        <img class="app-brand-mark" src="/rewind-icon.svg" alt="" />
        <span class="app-brand-name">Rewind</span>
      </div>
      <ProjectSelector
        :selected="project"
        @select-project="onSelectProject"
        @projects-loaded="onProjectsLoaded"
      />
    </div>
    <div class="layout">
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
        <TwoColumnViewer v-if="sessionFile" :file="sessionFile" :highlightUserId="highlightUserId" />
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

export default {
  components: { ProjectSelector, Sessions, SearchBox, SearchResults, TwoColumnViewer },
  data() {
    return {
      project: null,
      sessionFile: null,
      selectedSession: null,
      // Search state
      searchQuery: '',
      searchResults: [],
      searchLoading: false,
      highlightUserId: null,
      hasResolvedInitialProjectSelection: false,
      pendingInitialSessionSelection: false
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
    onProjectsLoaded(projects) {
      if (this.hasResolvedInitialProjectSelection) return

      this.hasResolvedInitialProjectSelection = true

      if (!this.project && Array.isArray(projects) && projects.length > 0) {
        this.onSelectProject(projects[0], { autoInitial: true })
      }
    },
    onSelectProject(p, options = {}) {
      this.project = p
      this.sessionFile = null
      this.selectedSession = null
      this.highlightUserId = null
      // Auto-select first session whenever project changes, unless there's an active search
      this.pendingInitialSessionSelection = true
      
      // If there's an active search query, re-trigger search in new project
      if (this.searchQuery && this.searchQuery.length >= 3) {
        this.pendingInitialSessionSelection = false
        this.onSearch(this.searchQuery)
      } else {
        this.clearSearch()
      }
    },
    onSessionsLoaded({ projectKey, sessions }) {
      if (!this.pendingInitialSessionSelection) return

      const currentProjectKey = this.project && (this.project.id || this.project.name)
      if (!currentProjectKey || projectKey !== currentProjectKey) return

      this.pendingInitialSessionSelection = false

      if (this.searchQuery || this.sessionFile || !Array.isArray(sessions) || sessions.length === 0) {
        return
      }

      this.onSelectSession(sessions[0].filePath, sessions[0], { highlightFirstUser: true })
    },
    onSelectSession(file, sessionObj, options = {}) {
      this.sessionFile = file
      this.selectedSession = sessionObj || null
      this.highlightUserId = options.highlightFirstUser ? AUTO_SELECT_FIRST_USER_ID : null
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
    onSelectSearchResult({ sessionFile, userId }) {
      // Load the session and highlight the user message
      this.pendingInitialSessionSelection = false
      this.highlightUserId = userId
      this.sessionFile = sessionFile
      this.selectedSession = null
    },
    clearSearch() {
      this.searchQuery = ''
      this.searchResults = []
      this.highlightUserId = null
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
</style>
