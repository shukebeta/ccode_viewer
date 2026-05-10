import mermaid from 'mermaid'

let _initialized = false
let _renderCount = 0

function _ensureInit() {
  if (_initialized) return
  _initialized = true
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'default',
  })
}

/**
 * Render a Mermaid diagram source string to SVG.
 * @param {string} code
 * @returns {Promise<{ svg: string|null, error: string|null }>}
 */
export async function renderMermaid(code) {
  _ensureInit()
  const id = `ccode-mermaid-${++_renderCount}`
  try {
    const { svg } = await mermaid.render(id, code)
    return { svg, error: null }
  } catch (err) {
    return { svg: null, error: err?.message ?? 'Invalid Mermaid diagram' }
  }
}

/** @internal */
export function _resetForTest() {
  _initialized = false
  _renderCount = 0
}
