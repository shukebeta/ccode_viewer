const projectsHandlers = new Set()
const sessionsHandlers = new Set()
const openHandlers = new Set()

let eventSource = null

function ensureEventSource() {
  if (eventSource) return eventSource
  const es = new EventSource('/api/events/list')

  es.addEventListener('projects_changed', () => {
    for (const handler of projectsHandlers) {
      try { handler() } catch (e) { console.error('projects_changed handler error', e) }
    }
  })

  es.addEventListener('sessions_changed', (ev) => {
    let payload = {}
    try { payload = JSON.parse(ev.data) } catch (e) { /* ignore */ }
    for (const handler of sessionsHandlers) {
      try { handler(payload) } catch (e) { console.error('sessions_changed handler error', e) }
    }
  })

  es.addEventListener('open', () => {
    for (const handler of openHandlers) {
      try { handler() } catch (e) { console.error('open handler error', e) }
    }
  })

  es.addEventListener('error', (e) => {
    // EventSource will auto-reconnect; nothing to do here.
    if (typeof console !== 'undefined' && console.debug) {
      console.debug('listEvents EventSource error (browser will retry)', e)
    }
  })

  eventSource = es
  return es
}

function maybeCloseEventSource() {
  if (!eventSource) return
  if (projectsHandlers.size > 0 || sessionsHandlers.size > 0 || openHandlers.size > 0) return
  try { eventSource.close() } catch (e) { /* ignore */ }
  eventSource = null
}

function subscribe(set, handler) {
  set.add(handler)
  ensureEventSource()
  return () => {
    set.delete(handler)
    maybeCloseEventSource()
  }
}

export function onProjectsChanged(handler) {
  return subscribe(projectsHandlers, handler)
}

export function onSessionsChanged(handler) {
  return subscribe(sessionsHandlers, handler)
}

export function onOpen(handler) {
  return subscribe(openHandlers, handler)
}

export function closeListEvents() {
  projectsHandlers.clear()
  sessionsHandlers.clear()
  openHandlers.clear()
  if (eventSource) {
    try { eventSource.close() } catch (e) { /* ignore */ }
    eventSource = null
  }
}
