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
        <button
          class="result-card"
          :class="{ selected: selectedResultId === (result.userMessage.id + result.sessionFile) }"
          @click="selectResult(result)"
        >
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
  data() {
    return {
      selectedResultId: null
    }
  },
  methods: {
    selectResult(result) {
      this.selectedResultId = result.userMessage.id + result.sessionFile
      this.$emit('select-result', {
        sessionFile: result.sessionFile,
        source: result.source || null,
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
  padding: var(--sp-2) 0;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--sp-3);
}

.results-header h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
}

.clear-search-btn {
  padding: var(--sp-1) var(--sp-3);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 12px;
  font-family: var(--font-sans);
  color: var(--text-secondary);
  transition: all var(--duration-fast) var(--ease-out);
}

.clear-search-btn:hover {
  background: var(--card-hover);
  border-color: var(--border-strong);
  color: var(--text);
}

.empty-state {
  text-align: center;
  padding: var(--sp-8) var(--sp-4);
  color: var(--text-muted);
  font-size: 13px;
}

.results-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.result-item {
  margin-bottom: var(--sp-1);
}

.result-card {
  display: block;
  width: 100%;
  text-align: left;
  border: 1px solid var(--border);
  background: var(--card);
  padding: var(--sp-3);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}

.result-card:hover {
  background: var(--card-hover);
  border-color: var(--accent);
  box-shadow: var(--shadow-sm);
}

.result-card.selected {
  background: var(--accent-muted);
  border-color: rgba(180, 83, 9, 0.25);
  box-shadow: var(--shadow-md);
}

.result-meta {
  display: flex;
  gap: var(--sp-3);
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: var(--sp-1);
}

.result-time { font-weight: 600; color: var(--text-secondary); }

.result-session {
  font-family: var(--font-mono);
  background: var(--bg);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: 11px;
}

.result-replies { color: var(--success); font-weight: 500; }

.result-preview {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.result-preview :deep(mark) {
  background: var(--accent-light);
  color: #92400e;
  padding: 1px 2px;
  border-radius: 2px;
  font-weight: 600;
}
</style>
