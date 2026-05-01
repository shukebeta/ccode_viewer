<template>
  <el-select
    v-model="selectedProject"
    filterable
    placeholder="Select Project"
    size="large"
    class="project-selector"
    @change="onProjectChange"
  >
    <el-option
      v-for="p in projects"
      :key="p.id"
      :label="displayName(p)"
      :value="p.id"
    >
      <div class="project-option">
        <span class="project-name">{{ displayName(p) }}</span>
        <span class="project-separator"> - </span>
        <span class="project-path">{{ displayPath(p) }}</span>
      </div>
    </el-option>
  </el-select>
</template>

<script>
export default {
  props: {
    selected: { type: Object, default: null }
  },
  data() {
    return {
      projects: [],
      selectedProject: null
    }
  },
  async mounted() {
    await this.loadProjects()

    // Set initial selection if provided
    if (this.selected) {
      this.selectedProject = this.selected.id
    }
  },
  watch: {
    selected(newVal) {
      if (newVal) {
        this.selectedProject = newVal.id
      }
    }
  },
  methods: {
    async loadProjects() {
      try {
        const res = await fetch('/api/projects')
        this.projects = await res.json()

        // Sort by most recent update
        this.projects.sort((a, b) => {
          if (a.lastUpdated && b.lastUpdated) {
            return new Date(b.lastUpdated) - new Date(a.lastUpdated)
          }
          if (a.lastUpdated) return -1
          if (b.lastUpdated) return 1
          return (b.sessionCount || 0) - (a.sessionCount || 0)
        })

        this.$emit('projects-loaded', this.projects)
      } catch (e) {
        console.error('Failed to load projects:', e)
      }
    },
    displayName(p) {
      const raw = p.name || ''
      // If backend already resolved to a filesystem path, show the basename
      if (raw.includes('/') || raw.includes('\\')) {
        const parts = raw.split(/[\\\/]/).filter(Boolean)
        return parts.length ? parts[parts.length - 1] : raw
      }
      // Preserve plain project names like "gridai-auto-job".
      return raw
    },
    displayPath(p) {
      // Show the resolved name (which may already be a full path) or fallback to stored path
      if (p.name && (p.name.includes('/') || p.name.includes('\\'))) {
        return p.name.replace(/\\/g, '/')
      }
      if (p.path) {
        return p.path.replace(/\\/g, '/')
      }
      return p.name
    },
    displayFullLabel(p) {
      const name = this.displayName(p)
      const path = this.displayPath(p)
      return path && path !== name ? `${name} - ${path}` : name
    },
    onProjectChange(projectId) {
      const project = this.projects.find(p => p.id === projectId)
      if (project) {
        this.$emit('select-project', project)
      }
    }
  }
}
</script>

<style scoped>
.project-selector {
  min-width: 300px;
  font-family: var(--font-sans);
}
.project-selector :deep(.el-select__placeholder) {
  font-weight: 600;
  color: var(--text);
}

.project-option {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  font-size: 14px;
}

.project-name {
  font-weight: 600;
  color: var(--text);
}

.project-separator {
  color: var(--text-muted);
}

.project-path {
  color: var(--text-secondary);
  font-size: 13px;
}

.project-meta {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
