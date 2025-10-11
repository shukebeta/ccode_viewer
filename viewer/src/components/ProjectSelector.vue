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
        <div class="project-name">{{ displayName(p) }}</div>
        <div class="project-path">{{ displayPath(p) }}</div>
      </div>
    </el-option>

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
      // Fallback: take last segment after '-' and replace dashes with spaces
      const parts = raw.split('-').filter(Boolean)
      return parts.length ? parts[parts.length - 1].replace(/-/g, ' ') : raw
    },
    },
    displayPath(p) {
      // Show the resolved name (which may already be a full path) or fallback to stored path
      if (p.name && (p.name.includes('/') || p.name.includes('\\'))) {
        return p.name.replace(/\\/g, '/')
      }
        return p.path.replace(/\\/g, '/')
      }
      return p.name
    onProjectChange(projectId) {
      const project = this.projects.find(p => p.id === projectId)
      if (project) {
        this.$emit('select-project', project)
      }
    }
    },
  }
}
</script>

<style scoped>
.project-selector {
  min-width: 300px;
}

.project-option {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.project-name {
  font-weight: 600;
  font-size: 14px;
}

.project-meta {
  font-size: 12px;
  color: #888;
}
</style>
