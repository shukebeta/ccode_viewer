<template>
  <div class="app-root">
    <div class="app-title">Claude Code Conversation Console</div>
    <div class="app-header">
      <ProjectSelector
        :selected="project"
        @select-project="onSelectProject"
      />
    </div>
    <div class="layout">
      <div class="sessions-panel" v-if="project">
        <SearchBox
          :resultCount="searchResults.length"
          :loading="searchLoading"
          @search="onSearch"
        />
        <SearchResults
          v-if="searchQuery"
          :results="searchResults"
          :query="searchQuery"
          @select-result="onSelectSearchResult"
          @clear-search="clearSearch"
        />
        <Sessions
          v-else
          :project="project"
          :currentSessionFile="sessionFile"
          @select-session="onSelectSession"
        />
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
      highlightUserId: null
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
    onSelectProject(p) {
      this.project = p
      this.sessionFile = null
      
      // If there's an active search query, re-trigger search in new project
      if (this.searchQuery && this.searchQuery.length >= 3) {
        this.onSearch(this.searchQuery)
      } else {
        this.clearSearch()
      }
    },
    onSelectSession(file, sessionObj) {
      this.sessionFile = file
      this.selectedSession = sessionObj || null
      this.highlightUserId = null
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
}

.app-title {
  padding: 8px 16px;
  font-size: 0.9rem;
  font-weight: 600;
  color: #374151;
  border-bottom: 1px solid rgba(2,6,23,0.06);
  background: rgba(250,250,252,0.5);
}

.app-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(2,6,23,0.08);
  background: linear-gradient(180deg, rgba(250,250,252,0.8), rgba(244,247,250,0.6));
}

.layout {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.sessions-panel {
  width: 320px;
  border-right: 1px solid #d1d5db;
  padding: 12px;
  overflow-y: auto;
  background: rgba(255,255,255,0.5);
}

.main-panel {
  flex: 1;
  min-width: 0;
  padding: 12px;
  overflow: auto;
}

.placeholder {
  color: #666;
  text-align: center;
  padding: 40px 20px;
  font-size: 14px;
}
</style>
