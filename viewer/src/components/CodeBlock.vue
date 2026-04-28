<template>
  <div class="code-block" :class="{ 'has-inline-copy': !hasLanguage }">
    <div v-if="hasLanguage" class="code-block-header">
      <span>{{ language }}</span>
      <ActionIconButton
        class="btn-icon"
        :style="{ padding: '4px', color: copied ? '#10b981' : 'var(--muted-foreground)' }"
        icon="copy"
        :active="copied"
        active-icon="check"
        label="Copy code"
        active-label="Copied code"
        @click="handleCopy"
      />
    </div>
    <ActionIconButton
      v-else
      class="btn-icon code-block-inline-copy"
      :style="{ padding: '4px', color: copied ? '#10b981' : 'var(--muted-foreground)' }"
      icon="copy"
      :active="copied"
      active-icon="check"
      label="Copy code"
      active-label="Copied code"
      @click="handleCopy"
    />
    <div style="position:relative">
      <pre
        :class="['prism', { 'line-numbers': showLineNumbers, 'is-collapsed': isCollapsible && !isExpanded }]"
        :style="prismStyle"
        ref="preRef"
      ><code :class="codeClass" v-html="highlighted"></code></pre>
    </div>
    <button v-if="isCollapsible" type="button" class="code-block-toggle" :aria-expanded="isExpanded" @click="isExpanded = !isExpanded">
      {{ isExpanded ? 'Show less' : 'Show more' }}
    </button>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import Prism from 'prismjs'
import ActionIconButton from './ActionIconButton.vue'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-markup'
import 'prismjs/components/prism-bash'

const props = defineProps({
  language: { type: String, default: '' },
  value: { type: String, required: true },
  collapsedLines: { type: Number, default: 4 },
  minCollapsibleLines: { type: Number, default: 5 }
})

const copied = ref(false)
const preRef = ref(null)
const isExpanded = ref(false)

const hasLanguage = computed(() => Boolean(props.language && props.language.trim()))
const lineCount = computed(() => {
  const value = String(props.value || '').replace(/\r\n/g, '\n')
  if (!value) return 0
  return value.split('\n').length
})
const showLineNumbers = computed(() => lineCount.value > 5)
const isCollapsible = computed(() => lineCount.value > props.minCollapsibleLines)
const codeClass = computed(() => (props.language ? `language-${props.language}` : ''))
const prismStyle = computed(() => {
  if (!isCollapsible.value || isExpanded.value) return undefined
  return {
    maxHeight: `${props.collapsedLines * 1.55 + 1.85}em`,
    overflow: 'hidden'
  }
})

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
.code-block { background: transparent; position: relative; margin: var(--sp-2) 0 }
.code-block-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin-bottom: var(--sp-2);
  font-weight: 600;
}
.code-block-inline-copy {
  position: absolute;
  top: var(--sp-2);
  right: var(--sp-2);
  z-index: 1;
  background: rgba(28, 25, 23, 0.85);
  border: 1px solid rgba(231, 229, 228, 0.15);
  backdrop-filter: blur(4px);
  border-radius: var(--radius-sm);
}
.btn-icon { border-radius: var(--radius-sm) }
.pre { overflow: auto }
.prism {
  padding: var(--sp-3);
  border-radius: var(--radius-md);
  background: var(--code-bg);
  color: var(--code-text);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
  border: none;
  position: relative;
}
.has-inline-copy .prism { padding-right: 44px; }
.prism.is-collapsed::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2.75rem;
  background: linear-gradient(180deg, rgba(28, 25, 23, 0), var(--code-bg));
  pointer-events: none;
}
.line-numbers { counter-reset: linenumber }
.code-block-toggle {
  display: inline-block;
  margin-top: var(--sp-1);
  background: transparent;
  border: none;
  color: var(--accent);
  cursor: pointer;
  padding: 2px var(--sp-1);
  font-size: 13px;
  font-weight: 500;
  transition: color var(--duration-fast);
}
.code-block-toggle:hover { color: var(--text); text-decoration: underline; }
</style>
