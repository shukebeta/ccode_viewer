const fs = require('fs').promises
const path = require('path')
const os = require('os')

const DEFAULT_DISCOVERY_CACHE_TTL_MS = 2000

const KIND_CONFIG = {
  claudecode: { prefix: 'claude', subdir: 'projects', envVar: 'CLAUDE_PROJECTS_PATH' },
  codex: { prefix: 'codex', subdir: 'sessions', envVar: 'CODEX_SESSIONS_PATH' },
  gcopilot: { prefix: 'copilot', subdir: 'session-state', envVar: 'COPILOT_SESSION_PATH' }
}

const discoveryCache = new Map()

function clearAgentHomeDiscoveryCache() {
  discoveryCache.clear()
}

function getKindConfig(kind) {
  const config = KIND_CONFIG[kind]
  if (!config) throw new Error(`Unknown agent home kind: ${kind}`)
  return config
}

function buildHomeNameRegex(prefix) {
  return new RegExp('^\\.' + prefix + '[^.\\\\/]*$')
}

async function safeRealpath(fsModule, target) {
  try {
    return await fsModule.realpath(target)
  } catch (e) {
    return target
  }
}

async function safeIsSymlink(fsModule, target) {
  try {
    const stat = await fsModule.lstat(target)
    return stat.isSymbolicLink()
  } catch (e) {
    return false
  }
}

async function buildOverrideDiscovery(kind, envValue, fsModule, pathModule) {
  const sessionDir = envValue
  const realPath = await safeRealpath(fsModule, sessionDir)
  const isSymlink = await safeIsSymlink(fsModule, sessionDir)
  return {
    kind,
    homeName: '<override>',
    homeDir: pathModule.dirname(sessionDir),
    sessionDir,
    realPath,
    isSymlink,
    isCanonical: false
  }
}

function canonicalHomeName(prefix) {
  return '.' + prefix
}

function compareDiscoveries(canonicalName) {
  return (a, b) => {
    if (a.homeName === canonicalName && b.homeName !== canonicalName) return -1
    if (b.homeName === canonicalName && a.homeName !== canonicalName) return 1
    if (a.homeName < b.homeName) return -1
    if (a.homeName > b.homeName) return 1
    return 0
  }
}

async function scanHomedirForKind(kind, homedir, fsModule, pathModule) {
  const { prefix, subdir } = getKindConfig(kind)
  const regex = buildHomeNameRegex(prefix)
  const canonicalName = canonicalHomeName(prefix)

  let entries = []
  try {
    entries = await fsModule.readdir(homedir, { withFileTypes: true })
  } catch (e) {
    return []
  }

  const candidates = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!regex.test(entry.name)) continue

    const homeDir = pathModule.join(homedir, entry.name)
    const sessionDir = pathModule.join(homeDir, subdir)

    let isSymlink
    try {
      const stat = await fsModule.lstat(sessionDir)
      isSymlink = stat.isSymbolicLink()
    } catch (e) {
      continue // sessionDir doesn't exist — skip silently
    }

    const realPath = await safeRealpath(fsModule, sessionDir)

    candidates.push({
      kind,
      homeName: entry.name,
      homeDir,
      sessionDir,
      realPath,
      isSymlink,
      isCanonical: entry.name === canonicalName
    })
  }

  candidates.sort(compareDiscoveries(canonicalName))

  const seen = new Set()
  const deduped = []
  for (const candidate of candidates) {
    if (seen.has(candidate.realPath)) continue
    seen.add(candidate.realPath)
    deduped.push(candidate)
  }

  return deduped
}

async function discoverAgentHomes(options = {}) {
  const kind = options.kind
  if (!kind) throw new Error('discoverAgentHomes requires a kind option')
  getKindConfig(kind) // validate

  const env = options.env || process.env
  const homedir = options.homedir || env.HOME || os.homedir()
  const fsModule = options.fsModule || fs
  const pathModule = options.pathModule || path
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_DISCOVERY_CACHE_TTL_MS
  const bypassCache = options.bypassCache === true
  const now = typeof options.now === 'number' ? options.now : Date.now()

  const { envVar } = getKindConfig(kind)
  const envOverride = env[envVar] || ''
  const cacheKey = `${kind}||${homedir}||${envOverride}`

  if (!bypassCache && cacheTtlMs > 0) {
    const cached = discoveryCache.get(cacheKey)
    if (cached && cached.expiresAt > now) {
      return cached.discoveries
    }
  }

  let discoveries
  if (envOverride) {
    discoveries = [await buildOverrideDiscovery(kind, envOverride, fsModule, pathModule)]
  } else {
    discoveries = await scanHomedirForKind(kind, homedir, fsModule, pathModule)
  }

  if (cacheTtlMs > 0) {
    discoveryCache.set(cacheKey, {
      discoveries,
      expiresAt: now + cacheTtlMs
    })
  }

  return discoveries
}

module.exports = {
  DEFAULT_DISCOVERY_CACHE_TTL_MS,
  discoverAgentHomes,
  clearAgentHomeDiscoveryCache
}
