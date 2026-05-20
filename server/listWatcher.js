const fs = require('fs')
const fsp = require('fs').promises
const path = require('path')
const { watch } = require('chokidar')

const { discoverAgentHomes, clearAgentHomeDiscoveryCache } = require('./discovery/agentHomeDiscovery')
const { readCopilotWorkspace } = require('./discovery/copilotWorkspaceDiscovery')
const { readCodexSessionMetaCwd } = require('./discovery/codexHead')
const { pathToClaudeDirName } = require('./fsHelpers')

const DEBOUNCE_MS = 500

const KIND_DEPTH = {
  claudecode: 2,
  codex: 4,
  gcopilot: 2
}

const subscribers = new Set()
const watchersByRealpath = new Map()
const knownProjectIds = new Set()
const codexProjectPathCache = new Map()
const copilotProjectPathCache = new Map()
const pendingDirty = { projectsList: false, sessionsByProject: new Set() }
let flushTimer = null
let initPromise = null

function isCodexRolloutFile(p) {
  return /^rollout-.*\.jsonl$/i.test(path.basename(p))
}

function isClaudecodeJsonl(p) {
  return path.extname(p).toLowerCase() === '.jsonl'
}

function isGcopilotTrackedFile(p) {
  const base = path.basename(p)
  return base === 'events.jsonl' || base === 'workspace.yaml'
}

async function walkCodexRolloutFiles(root) {
  const files = []
  async function walk(current) {
    let entries = []
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch (e) {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile() && isCodexRolloutFile(entry.name)) files.push(full)
    }
  }
  await walk(root)
  return files
}

async function readGcopilotProjectIdFromDir(sessionDir) {
  const ws = await readCopilotWorkspace(sessionDir)
  if (!ws || typeof ws.cwd !== 'string' || !ws.cwd.trim()) return null
  return pathToClaudeDirName(ws.cwd.trim())
}

async function seedKnownProjectIds({ claudecode, codex, gcopilot }) {
  for (const home of claudecode) {
    let names = []
    try { names = await fsp.readdir(home.sessionDir) } catch (e) { /* missing root */ }
    for (const name of names) knownProjectIds.add(name)
  }
  for (const home of gcopilot) {
    let names = []
    try { names = await fsp.readdir(home.sessionDir) } catch (e) { /* missing root */ }
    for (const name of names) {
      const sessionDir = path.join(home.sessionDir, name)
      const projectId = await readGcopilotProjectIdFromDir(sessionDir)
      if (projectId) {
        copilotProjectPathCache.set(sessionDir, projectId)
        knownProjectIds.add(projectId)
      }
    }
  }
  for (const home of codex) {
    const files = await walkCodexRolloutFiles(home.sessionDir)
    for (const filePath of files) {
      const cwd = await readCodexSessionMetaCwd(filePath)
      if (cwd) {
        const projectId = pathToClaudeDirName(cwd)
        codexProjectPathCache.set(filePath, projectId)
        knownProjectIds.add(projectId)
      }
    }
  }
}

async function deriveProjectId(kind, home, eventPath, eventType) {
  if (kind === 'claudecode') {
    if (eventType === 'addDir' || eventType === 'unlinkDir') {
      return path.basename(eventPath)
    }
    return path.basename(path.dirname(eventPath))
  }

  if (kind === 'codex') {
    const cached = codexProjectPathCache.get(eventPath)
    if (eventType === 'unlink') {
      codexProjectPathCache.delete(eventPath)
      return cached || null
    }
    if (cached) return cached
    const cwd = await readCodexSessionMetaCwd(eventPath)
    if (!cwd) return null
    const projectId = pathToClaudeDirName(cwd)
    codexProjectPathCache.set(eventPath, projectId)
    return projectId
  }

  if (kind === 'gcopilot') {
    if (eventType === 'addDir') {
      const fresh = await readGcopilotProjectIdFromDir(eventPath)
      if (fresh) copilotProjectPathCache.set(eventPath, fresh)
      return fresh || null
    }
    if (eventType === 'unlinkDir') {
      const cached = copilotProjectPathCache.get(eventPath)
      copilotProjectPathCache.delete(eventPath)
      return cached || null
    }
    const sessionDir = path.dirname(eventPath)
    const basename = path.basename(eventPath)
    if (basename === 'workspace.yaml') {
      if (eventType === 'unlink') {
        const cached = copilotProjectPathCache.get(sessionDir)
        copilotProjectPathCache.delete(sessionDir)
        return cached || null
      }
      const fresh = await readGcopilotProjectIdFromDir(sessionDir)
      if (!fresh) return null
      copilotProjectPathCache.set(sessionDir, fresh)
      return fresh
    }
    const cached = copilotProjectPathCache.get(sessionDir)
    if (cached) return cached
    const fresh = await readGcopilotProjectIdFromDir(sessionDir)
    if (fresh) copilotProjectPathCache.set(sessionDir, fresh)
    return fresh || null
  }

  return null
}

async function onFsEvent(kind, home, eventPath, eventType) {
  let projectId = null
  try {
    projectId = await deriveProjectId(kind, home, eventPath, eventType)
  } catch (e) {
    projectId = null
  }

  const isStructuralAddRemove =
    (kind === 'claudecode' || kind === 'gcopilot') &&
    (eventType === 'addDir' || eventType === 'unlinkDir')
  const isCodexNewProject = kind === 'codex' && projectId != null && !knownProjectIds.has(projectId)

  if (!projectId && !isStructuralAddRemove) return

  if (isStructuralAddRemove || isCodexNewProject) {
    pendingDirty.projectsList = true
  }
  if (projectId) {
    pendingDirty.sessionsByProject.add(projectId)
    knownProjectIds.add(projectId)
  }

  scheduleFlush()
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushDirty()
  }, DEBOUNCE_MS)
}

function flushDirty() {
  const projectsChanged = pendingDirty.projectsList
  const sessions = Array.from(pendingDirty.sessionsByProject)
  pendingDirty.projectsList = false
  pendingDirty.sessionsByProject.clear()

  if (!projectsChanged && sessions.length === 0) return

  for (const res of subscribers) {
    if (projectsChanged) {
      try {
        res.write('event: projects_changed\n')
        res.write('data: {}\n\n')
      } catch (e) { /* dead subscriber; ignore */ }
    }
    for (const projectId of sessions) {
      try {
        res.write('event: sessions_changed\n')
        res.write(`data: ${JSON.stringify({ projectId })}\n\n`)
      } catch (e) { /* dead subscriber; ignore */ }
    }
  }
}

function attachWatcher(kind, home) {
  if (watchersByRealpath.has(home.realPath)) return null

  const depth = KIND_DEPTH[kind]
  let watcher
  try {
    watcher = watch(home.sessionDir, { ignoreInitial: true, depth, persistent: true })
  } catch (e) {
    return null
  }
  watchersByRealpath.set(home.realPath, {
    kind,
    watcher,
    homeName: home.homeName,
    sessionDir: home.sessionDir,
    realPath: home.realPath
  })

  const ready = new Promise((resolve) => {
    watcher.once('ready', resolve)
  })

  const isTopLevelDir = (p) => path.dirname(p) === home.sessionDir

  const fileFilter =
    kind === 'codex' ? isCodexRolloutFile :
    kind === 'gcopilot' ? isGcopilotTrackedFile :
    isClaudecodeJsonl

  for (const eventType of ['add', 'change', 'unlink']) {
    watcher.on(eventType, (p) => {
      if (!fileFilter(p)) return
      onFsEvent(kind, home, p, eventType)
    })
  }

  if (kind !== 'codex') {
    for (const eventType of ['addDir', 'unlinkDir']) {
      watcher.on(eventType, (p) => {
        if (!isTopLevelDir(p)) return
        onFsEvent(kind, home, p, eventType)
      })
    }
  }

  watcher.on('error', (err) => {
    if (process.env.LIST_WATCHER_DEBUG) console.error('list watcher error', err)
  })

  return ready
}

async function ensureWatchers() {
  if (watchersByRealpath.size > 0) return
  if (initPromise) return initPromise
  initPromise = (async () => {
    clearAgentHomeDiscoveryCache()
    const [claudecode, codex, gcopilot] = await Promise.all([
      discoverAgentHomes({ kind: 'claudecode' }),
      discoverAgentHomes({ kind: 'codex' }),
      discoverAgentHomes({ kind: 'gcopilot' })
    ])
    await seedKnownProjectIds({ claudecode, codex, gcopilot })
    const readyPromises = []
    for (const home of claudecode) {
      const p = attachWatcher('claudecode', home)
      if (p) readyPromises.push(p)
    }
    for (const home of codex) {
      const p = attachWatcher('codex', home)
      if (p) readyPromises.push(p)
    }
    for (const home of gcopilot) {
      const p = attachWatcher('gcopilot', home)
      if (p) readyPromises.push(p)
    }
    await Promise.all(readyPromises)
  })().finally(() => { initPromise = null })
  return initPromise
}

function teardownAll() {
  for (const [, info] of watchersByRealpath) {
    try { info.watcher.close() } catch (e) {}
  }
  watchersByRealpath.clear()
  knownProjectIds.clear()
  codexProjectPathCache.clear()
  copilotProjectPathCache.clear()
  pendingDirty.projectsList = false
  pendingDirty.sessionsByProject.clear()
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  initPromise = null
}

async function subscribeListEvents(res) {
  subscribers.add(res)
  try {
    await ensureWatchers()
  } catch (e) {
    if (process.env.LIST_WATCHER_DEBUG) console.error('list watcher init failed', e)
  }
}

function unsubscribeListEvents(res) {
  if (!subscribers.delete(res)) return
  if (subscribers.size === 0) teardownAll()
}

function getWatcherCount() {
  return watchersByRealpath.size
}

function clearForTest() {
  subscribers.clear()
  teardownAll()
}

module.exports = {
  subscribeListEvents,
  unsubscribeListEvents,
  _private: {
    DEBOUNCE_MS,
    onFsEvent,
    flushDirty,
    getWatcherCount,
    clearForTest,
    subscribers,
    watchersByRealpath,
    knownProjectIds,
    codexProjectPathCache,
    copilotProjectPathCache,
    pendingDirty
  }
}
