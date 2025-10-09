<template>
  <div>
    <h2>Projects</h2>
    <ul class="project-list">
      <li v-for="p in projects" :key="p.name">
        <div :class="['project-card', { active: selected && selected.name === p.name }]" @click="$emit('select-project', p)">
          <div class="project-title">{{ displayName(p) }}</div>
          <div class="project-path">{{ displayPath(p) }}</div>
          <div class="project-meta">{{ p.sessionCount }} sessions</div>
        </div>
      </li>
    </ul>
  </div>
</template>

<script>
export default {
  props: { selected: { type: Object, default: null } },
  data() {
    return { projects: [] }
  },
  async mounted() {
    try {
      const res = await fetch('/api/projects')
      this.projects = await res.json()
      // sort by most recent update (lastUpdated) descending; fallback to sessionCount
      this.projects.sort((a, b) => {
        if (a.lastUpdated && b.lastUpdated) return new Date(b.lastUpdated) - new Date(a.lastUpdated)
        if (a.lastUpdated) return -1
        if (b.lastUpdated) return 1
        return (b.sessionCount || 0) - (a.sessionCount || 0)
      })
    } catch (e) {
      console.error(e)
    }
  },
  methods: {
    // project.name is the sanitized name like '-home-davidwei-AndroidStudioProjects-happy-notes'
    displayName(p) {
      const raw = p.name || ''
      // If backend already resolved to a filesystem path, show the basename
      if (raw.includes('/') || raw.includes('\\')) {
        const parts = raw.split(/\\\\|\//).filter(Boolean)
        return parts.length ? parts[parts.length - 1] : raw
      }
      // fallback: take last segment after '-' and replace dashes with spaces
      const parts = raw.split('-').filter(Boolean)
      return parts.length ? parts[parts.length - 1].replace(/-/g, ' ') : raw
    },
    displayPath(p) {
      // show the resolved name (which may already be a full path) or fallback to stored path
      if (p.name && (p.name.includes('/') || p.name.includes('\\'))) return p.name.replace(/\\/g, '/')
      if (p.path) return p.path.replace(/\\/g, '/')
      return p.name
    }
  }
}
</script>

<style>
.project-list { list-style: none; padding: 0; margin: 0 }
.project-card { padding: 10px; border: 1px solid transparent; border-radius: 8px; margin-bottom: 8px; cursor: pointer; transition: all .12s }
.project-card:hover { background: rgba(255,255,255,0.04); border-color: rgba(2,6,23,0.04) }
.project-card.active, .project-card:active { background: rgba(37,99,235,0.08); border-color: rgba(37,99,235,0.18); box-shadow: 0 2px 8px rgba(37,99,235,0.06) }
.project-title { font-weight: 600 }
.project-path { font-size: 12px; color: #666; margin-top: 4px; opacity: 0; height: 0; transition: opacity .12s, height .12s; overflow: hidden }
.project-card:hover .project-path { opacity: 1; height: auto }
.project-meta { font-size: 12px; color: #888; margin-top: 6px }
</style>
