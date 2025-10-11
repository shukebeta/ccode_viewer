<template>
  <div class="search-results">
    <div class="results-header">
      <h3>{{ results.length }} result{{ results.length !== 1 ? 's' : '' }}</h3>
      <button class="clear-search-btn" @click="$emit('clear-search')">
        Back to Sessions
      </button>
    </div>

    <div v-if="results.length === 0" class="empty-state">
      <p>No matches found for "{{ query }}"</p>
    </div>

    <ul v-else class="results-list">
      <li v-for="result in results" :key="result.userMessage.id + result.sessionFile" class="result-item">
        <button class="result-card" @click="selectResult(result)">
          <div class="result-meta">
            <span class="result-time">{{ formatTime(result.timestamp) }}</span>
            <span class="result-session">{{ formatSessionId(result.sessionId) }}</span>
            <span class="result-replies" v-if="result.assistantReplies.length > 0">
              {{ result.assistantReplies.length }} repl{{ result.assistantReplies.length !== 1 ? 'ies' : 'y' }}
            </span>
          </div>
          <div class="result-preview" v-html="highlightQuery(result.userMessage.preview)"></div>
        </button>
      </li>
    </ul>
  </div>
</template>

<script>
export default {
  props: ['results', 'query'],
  methods: {
    selectResult(result) {
      this.$emit('select-result', {
        sessionFile: result.sessionFile,
        userId: result.userMessage.id
      })
    },
    formatTime(ts) {
      if (!ts) return ''
      try {
        const d = new Date(ts)
        if (isNaN(d.getTime())) return ts
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        const hh = String(d.getHours()).padStart(2, '0')
        const mm = String(d.getMinutes()).padStart(2, '0')
        return `${y}-${m}-${day} ${hh}:${mm}`
      } catch (e) {
        return ts
      }
    },
    formatSessionId(id) {
      // Show first 8 characters of session ID
      return id ? id.substring(0, 8) : ''
    },
    highlightQuery(text) {
      if (!this.query || !text) return this.escapeHtml(text)

      const escapedText = this.escapeHtml(text)
      const escapedQuery = this.escapeHtml(this.query)

      // Case-insensitive highlight
      const regex = new RegExp(`(${escapedQuery})`, 'gi')
      return escapedText.replace(regex, '<mark>$1</mark>')
    },
    escapeHtml(text) {
      const div = document.createElement('div')
      div.textContent = text
      return div.innerHTML
    }
  }
}
</script>

<style scoped>
.search-results {
  padding: 8px 0;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.results-header h3 {
  margin: 0;
  font-size: 16px;
}

.clear-search-btn {
  padding: 6px 12px;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: #374151;
}

.clear-search-btn:hover {
  background: #f9fafb;
  border-color: #9ca3af;
}

.empty-state {
  text-align: center;
  padding: 32px 16px;
  color: #6b7280;
}

.results-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.result-item {
  margin-bottom: 8px;
}

.result-card {
  display: block;
  width: 100%;
  text-align: left;
  border: 1px solid #e5e7eb;
  background: white;
  padding: 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.12s;
}

.result-card:hover {
  background: #f9fafb;
  border-color: #3b82f6;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.result-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 6px;
}

.result-time {
  font-weight: 600;
}

.result-session {
  font-family: monospace;
  background: #f3f4f6;
  padding: 2px 6px;
  border-radius: 3px;
}

.result-replies {
  color: #059669;
}

.result-preview {
  font-size: 14px;
  line-height: 1.5;
  color: #1f2937;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.result-preview :deep(mark) {
  background: #fef3c7;
  color: #92400e;
  padding: 2px 0;
  border-radius: 2px;
  font-weight: 500;
}
</style>
