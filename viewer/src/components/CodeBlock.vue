<template>
  <div class="code-block" :style="{ margin: '16px 0' }">
    <div class="code-block-header" style="display:flex;justify-content:space-between;align-items:center">
      <span>{{ language }}</span>
      <button
        type="button"
        @click="handleCopy"
        class="btn-icon"
        :title="copied ? 'Copied code' : 'Copy code'"
        :aria-label="copied ? 'Copied code' : 'Copy code'"
        :style="{ padding: '4px', color: copied ? '#10b981' : 'var(--muted-foreground)' }"
      >
        <svg
          v-if="copied"
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <svg
          v-else
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
    </div>
    <div style="position:relative">
      <pre :class="['prism', { 'line-numbers': showLineNumbers }]" ref="preRef"><code :class="codeClass" v-html="highlighted"></code></pre>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import Prism from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-markup'
import 'prismjs/components/prism-bash'

const props = defineProps({ language: { type: String, default: '' }, value: { type: String, required: true } })

const copied = ref(false)
const preRef = ref(null)

const showLineNumbers = computed(() => props.value.split('\n').length > 5)
const codeClass = computed(() => (props.language ? `language-${props.language}` : ''))

const highlighted = computed(() => {
  try {
    const lang = props.language || 'javascript'
    if (Prism.languages[lang]) {
      return Prism.highlight(props.value, Prism.languages[lang], lang)
    }
  } catch (e) {
    // fallback
  }
  return Prism.util.encode(props.value)
})

async function handleCopy() {
  try {
    await navigator.clipboard.writeText(props.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch (e) {
    const ta = document.createElement('textarea')
    ta.value = props.value
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  }
}
</script>

<style scoped>
.code-block { background: transparent }
.code-block-header { font-size: 12px; color: var(--muted-foreground); margin-bottom: 8px }
.btn-icon { display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; border-radius: 6px; cursor: pointer; line-height: 0 }
.btn-icon svg { display: block }
.pre { overflow: auto }
.prism { padding: 12px; border-radius: 6px; background: var(--code-bg, #f5f5f7); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Courier New', monospace; font-size: 13px; line-height: 1.5 }
.line-numbers { counter-reset: linenumber }
</style>
