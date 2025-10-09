<template>
  <div>
    <h3>Sessions for {{ project.name }}</h3>
    <div v-if="loading">Loading...</div>
    <ul v-else class="sessions-list">
      <li v-for="s in sessions" :key="s.filePath" class="session-item">
        <button class="session-card" @click="$emit('select-session', s.filePath, s)">
          <div class="session-time">{{ formatTime(s.lastTime || s.startTime) }} <span class="muted">({{ s.messageCount }})</span></div>
          <div class="session-preview">{{ shortPreview(s.preview || s.id) }}</div>
        </button>
      </li>
    </ul>
  </div>
</template>

<script>
export default {
  props: ['project'],
  data() { return { sessions: [], loading: false } },
  watch: {
    project: {
      immediate: true,
      handler() { this.load() }
    }
  },
  methods: {
    async load() {
      if (!this.project) return
      this.loading = true
      try {
        const key = this.project.id || this.project.name
        const res = await fetch('/api/sessions?project=' + encodeURIComponent(key))
        this.sessions = await res.json()
      } catch (e) { console.error(e) }
      this.loading = false
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

<style scoped>
.sessions-list { list-style:none; padding:0; margin:8px 0 }
.session-item { margin-bottom:8px }
.session-card { display:block; width:100%; text-align:left; border:1px solid #eee; background:var(--card); padding:8px; border-radius:6px }
.session-time { font-weight:600; font-size:13px; margin-bottom:4px }
.session-preview { color:var(--muted); font-size:13px }
.muted { color:#888; font-size:12px; margin-left:6px }
</style>
