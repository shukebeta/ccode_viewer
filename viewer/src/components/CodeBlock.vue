<template>
  <div class="code-block" :style="{ margin: '16px 0' }">
    <div class="code-block-header" style="display:flex;justify-content:space-between;align-items:center">
      <span>{{ language }}</span>
      <button @click="handleCopy" class="btn-icon" :style="{ padding: '4px', color: copied ? '#10b981' : 'var(--muted-foreground)' }">
        <span v-if="copied">✔</span>
        <span v-else>⧉</span>
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
.pre { overflow: auto }
.prism { padding: 12px; border-radius: 6px; background: var(--code-bg, #f5f5f7); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Courier New', monospace; font-size: 13px; line-height: 1.5 }
.line-numbers { counter-reset: linenumber }
</style>
