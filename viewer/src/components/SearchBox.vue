<template>
  <div class="search-box">
    <input
      ref="searchInput"
      v-model="query"
      type="text"
      placeholder="Search in project... (min 3 chars)"
      class="search-input"
      @input="onInput"
      @keydown.esc="clearSearch"
    />
    <div class="search-info">
      <span v-if="loading" class="loading">Searching...</span>
      <span v-else-if="query.length >= 3 && resultCount !== null" class="result-count">
        {{ resultCount }} result{{ resultCount !== 1 ? 's' : '' }}
      </span>
      <button v-if="query" class="clear-btn" @click="clearSearch" title="Clear search (Esc)">
        ✕
      </button>
    </div>
  </div>
</template>

<script>
export default {
  props: ['resultCount', 'loading'],
  data() {
    return {
      query: '',
      debounceTimer: null
    }
  },
  mounted() {
    // Add keyboard shortcut (Ctrl+F / Cmd+F)
    document.addEventListener('keydown', this.handleKeydown)
  },
  beforeUnmount() {
    document.removeEventListener('keydown', this.handleKeydown)
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
  },
  methods: {
    handleKeydown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        this.$refs.searchInput?.focus()
      }
    },
    onInput() {
      // Debounce search to avoid too many API calls
      if (this.debounceTimer) clearTimeout(this.debounceTimer)

      if (this.query.length < 3) {
        // Clear search if query too short
        this.$emit('search', '')
        return
      }

      this.debounceTimer = setTimeout(() => {
        this.$emit('search', this.query)
      }, 500)
    },
    clearSearch() {
      this.query = ''
      this.$emit('search', '')
    }
  }
}
</script>

<style scoped>
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px;
  background: var(--card, white);
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.search-input {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 14px;
  outline: none;
}

.search-input:focus {
  border-color: #60a5fa;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

.search-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 100px;
  font-size: 13px;
  color: #6b7280;
}

.loading {
  color: #3b82f6;
  font-style: italic;
}

.result-count {
  color: #059669;
  font-weight: 500;
}

.clear-btn {
  padding: 4px 8px;
  background: transparent;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  cursor: pointer;
  color: #6b7280;
  font-size: 14px;
  line-height: 1;
}

.clear-btn:hover {
  background: #f3f4f6;
  color: #374151;
}
</style>
