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
      <button v-show="query.length > 0" class="clear-btn" @click="clearSearch" title="Clear search (Esc)">
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
  gap: var(--sp-1);
  margin-bottom: var(--sp-3);
  padding: 0 var(--sp-3);
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
  font-size: 14px;
  color: var(--text-muted);
  pointer-events: none;
}

.search-input {
  width: 100%;
  max-width: none;
  padding: var(--sp-2) 28px var(--sp-2) 30px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 13px;
  font-family: var(--font-sans);
  background: var(--card);
  color: var(--text);
  outline: none;
  transition: border-color var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out);
}

.search-input:focus {
  border-color: var(--accent);
  box-shadow: var(--shadow-focus);
}

.search-input::placeholder {
  color: var(--text-muted);
}

.loading { color: var(--info); font-style: italic; }
.result-count { color: var(--success); font-weight: 500; }

.clear-btn {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  padding: 2px 4px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1;
  z-index: 20;
  transition: all var(--duration-fast) var(--ease-out);
}

.clear-btn:hover {
  background: var(--card-hover);
  color: var(--text);
  border-color: var(--border-strong);
}
</style>
