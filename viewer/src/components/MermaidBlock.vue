<template>
  <div class="mermaid-block">
    <div v-if="svg" class="mermaid-toolbar" data-testid="mermaid-toolbar">
      <button
        class="mermaid-zoom-btn"
        title="Open fullscreen diagram"
        data-testid="mermaid-fullscreen"
        @click="openFullscreen"
      >⛶</button>
    </div>
    <div
      v-if="svg"
      ref="inlineHostEl"
      class="mermaid-svg"
      data-testid="mermaid-svg"
      v-html="svg"
    />
    <div v-else-if="error" class="mermaid-error" data-testid="mermaid-error">
      <span class="mermaid-warning">⚠ Mermaid syntax error: {{ error }}</span>
      <pre class="mermaid-fallback">{{ code }}</pre>
    </div>
    <div v-else class="mermaid-loading" data-testid="mermaid-loading">
      <span style="color: var(--text-muted); font-size: 12px;">Rendering diagram…</span>
    </div>

    <dialog
      ref="dialogEl"
      class="mermaid-dialog"
      data-testid="mermaid-dialog"
      @close="onDialogClose"
    >
      <header class="mermaid-dialog-header">
        <span class="mermaid-dialog-title">Diagram</span>
        <div class="mermaid-toolbar" style="opacity: 1; margin: 0;">
          <button
            class="mermaid-zoom-btn"
            :disabled="dialogScale <= MIN_SCALE"
            title="Zoom out"
            data-testid="mermaid-dialog-zoom-out"
            @click="zoomOut"
          >−</button>
          <button
            class="mermaid-zoom-btn"
            title="Reset zoom"
            data-testid="mermaid-dialog-zoom-reset"
            @click="resetZoom"
          >
            <span class="mermaid-zoom-label">{{ Math.round(dialogScale * 100) }}%</span>
          </button>
          <button
            class="mermaid-zoom-btn"
            :disabled="dialogScale >= MAX_SCALE"
            title="Zoom in"
            data-testid="mermaid-dialog-zoom-in"
            @click="zoomIn"
          >+</button>
        </div>
        <button
          class="mermaid-dialog-close"
          title="Close (Esc)"
          data-testid="mermaid-dialog-close"
          @click="closeFullscreen"
        >×</button>
      </header>
      <div class="mermaid-dialog-body">
        <div ref="dialogScrollEl" class="mermaid-dialog-scroll" data-testid="mermaid-dialog-scroll">
          <div
            ref="dialogHostEl"
            class="mermaid-dialog-canvas"
            data-testid="mermaid-dialog-canvas"
            v-html="dialogSvg"
          />
        </div>
      </div>
    </dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { renderMermaid } from '../lib/mermaidService.js'

const props = defineProps({
  code: { type: String, required: true },
})

const MIN_SCALE = 0.25
const MAX_SCALE = 4
const SCALE_STEP = 0.25

const svg = ref(null)
const error = ref(null)
const inlineHostEl = ref(null)
const dialogEl = ref(null)
const dialogHostEl = ref(null)
const dialogScrollEl = ref(null)
const dialogOpen = ref(false)
const dialogScale = ref(1)
let renderToken = 0

const dialogSvg = computed(() => (dialogOpen.value ? svg.value : ''))

function parseSvgLength(value) {
  if (!value) return null
  const match = String(value).trim().match(/^([0-9]*\.?[0-9]+)/)
  return match ? Number(match[1]) : null
}

function readSvgDimensions(svgEl) {
  const width = parseSvgLength(svgEl.getAttribute('width'))
  const height = parseSvgLength(svgEl.getAttribute('height'))
  if (width && height) return { width, height }

  const viewBox = svgEl.getAttribute('viewBox')
  if (!viewBox) return null

  const parts = viewBox.trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || !Number.isFinite(parts[2]) || !Number.isFinite(parts[3])) return null
  return { width: parts[2], height: parts[3] }
}

function applyInlineLayout() {
  const svgEl = inlineHostEl.value?.querySelector('svg')
  if (!svgEl) return

  const dims = readSvgDimensions(svgEl)
  svgEl.style.width = dims ? `${dims.width}px` : ''
  svgEl.style.maxWidth = '100%'
  svgEl.style.height = 'auto'
}

function applyDialogLayout() {
  const svgEl = dialogHostEl.value?.querySelector('svg')
  if (!svgEl) return

  const dims = readSvgDimensions(svgEl)
  if (!dims) {
    svgEl.style.width = ''
    svgEl.style.maxWidth = 'none'
    svgEl.style.height = 'auto'
    return
  }

  const width = +(dims.width * dialogScale.value).toFixed(2)
  const height = +(dims.height * dialogScale.value).toFixed(2)
  svgEl.style.width = `${width}px`
  svgEl.style.maxWidth = 'none'
  svgEl.style.height = `${height}px`
}

async function syncRenderedSvg() {
  await nextTick()
  applyInlineLayout()
  if (dialogOpen.value) applyDialogLayout()
}

function zoomIn() {
  dialogScale.value = Math.min(MAX_SCALE, +(dialogScale.value + SCALE_STEP).toFixed(2))
}
function zoomOut() {
  dialogScale.value = Math.max(MIN_SCALE, +(dialogScale.value - SCALE_STEP).toFixed(2))
}
function resetZoom() {
  dialogScale.value = 1
}
function openFullscreen() {
  if (!dialogEl.value) return
  resetZoom()
  dialogOpen.value = true
  if (typeof dialogEl.value.showModal === 'function') {
    dialogEl.value.showModal()
  } else {
    dialogEl.value.setAttribute('open', '')
  }
  syncRenderedSvg()
}
function closeFullscreen() {
  if (!dialogEl.value) return
  if (typeof dialogEl.value.close === 'function') {
    dialogEl.value.close()
    return
  }
  dialogEl.value.removeAttribute('open')
  onDialogClose()
}
function onDialogClose() {
  dialogOpen.value = false
  dialogScale.value = 1
  dialogScrollEl.value?.scrollTo?.({ left: 0, top: 0 })
}

async function render() {
  const token = ++renderToken
  svg.value = null
  error.value = null
  const result = await renderMermaid(props.code)
  if (token !== renderToken) return
  if (result.error) {
    error.value = result.error
  } else {
    svg.value = result.svg
  }
}

onMounted(render)
watch(() => props.code, render)
watch(svg, syncRenderedSvg)
watch(dialogSvg, syncRenderedSvg)
watch(dialogScale, () => {
  if (!dialogOpen.value) return
  syncRenderedSvg()
})
</script>
