// URL hash helpers for restoring project/session selection across reloads.
//
// Invariant: writeHash uses history.replaceState, which does NOT fire the
// `hashchange` event. The optional hashchange listener (see App.vue) relies on
// this — switching to pushState would create a feedback loop where our own
// writes re-enter the restore logic.

function getWindow(env) {
  return env || (typeof window !== 'undefined' ? window : null)
}

export function readHash(env) {
  const win = getWindow(env)
  if (!win || !win.location || !win.location.hash) return null
  const raw = win.location.hash.replace(/^#/, '')
  if (!raw) return null

  const params = {}
  for (const pair of raw.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    const key = decodeURIComponent(pair.slice(0, eq))
    let value
    try {
      value = decodeURIComponent(pair.slice(eq + 1))
    } catch (e) {
      return null
    }
    params[key] = value
  }

  if (!params.project && !params.session) return null

  return {
    project: params.project || null,
    session: params.session || null,
    source: params.source || null
  }
}

export function writeHash(state, env) {
  const win = getWindow(env)
  if (!win || !win.history || !win.location) return

  const parts = []
  if (state && state.project) parts.push('project=' + encodeURIComponent(state.project))
  if (state && state.session) parts.push('session=' + encodeURIComponent(state.session))
  if (state && state.source) parts.push('source=' + encodeURIComponent(state.source))

  if (parts.length === 0) {
    const base = (win.location.pathname || '') + (win.location.search || '')
    win.history.replaceState(null, '', base || ' ')
    return
  }

  win.history.replaceState(null, '', '#' + parts.join('&'))
}
