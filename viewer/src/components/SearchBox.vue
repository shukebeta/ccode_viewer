<template>
  <div class="search-box">
    <div class="search-input-wrapper">
      <span class="search-icon">🔍</span>
      <input
        ref="searchInput"
        v-model="query"
        type="text"
        placeholder="(min 3 chars)"
        class="search-input"
        @input="onInput"
        @keydown.esc="clearSearch"
      />
    </div>
    <div class="search-actions">
      <span v-if="loading" class="loading">Searching...</span>
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

.search-input-wrapper {
  position: relative;
  flex: 1;
}

.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 16px;
  color: #9ca3af;
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 6px 8px 6px 32px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 14px;
  outline: none;
}

.search-actions {
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
