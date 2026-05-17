<template>
  <button
    type="button"
    class="action-icon-button"
    :title="currentLabel"
    :aria-label="currentLabel"
    @click="$emit('click', $event)"
  >
    <svg
      v-if="currentIcon === 'copy'"
      xmlns="http://www.w3.org/2000/svg"
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
    <svg
      v-else-if="currentIcon === 'document'"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M10 13h4" />
      <path d="M10 17h4" />
    </svg>
    <svg
      v-else-if="currentIcon === 'check'"
      xmlns="http://www.w3.org/2000/svg"
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
  </button>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  icon: { type: String, required: true },
  active: { type: Boolean, default: false },
  activeIcon: { type: String, default: '' },
  label: { type: String, required: true },
  activeLabel: { type: String, default: '' }
})

defineEmits(['click'])

const currentIcon = computed(() => (props.active && props.activeIcon ? props.activeIcon : props.icon))
const currentLabel = computed(() => (props.active && props.activeLabel ? props.activeLabel : props.label))
</script>

<style scoped>
.action-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  line-height: 0;
  padding: 0;
  transition: color var(--duration-fast) var(--ease-out);
}

.action-icon-button:hover {
  color: var(--text);
}

.action-icon-button svg {
  display: block;
  width: 14px;
  height: 14px;
  overflow: visible;
}
</style>
