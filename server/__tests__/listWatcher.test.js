import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  subscribeListEvents,
  unsubscribeListEvents,
  _private as priv
} from '../listWatcher'
import { clearAgentHomeDiscoveryCache } from '../discovery/agentHomeDiscovery'
import { clearCopilotDiscoveryCache } from '../discovery/copilotWorkspaceDiscovery'

const ORIGINAL_HOME = process.env.HOME
const ORIGINAL_CLAUDE = process.env.CLAUDE_PROJECTS_PATH
const ORIGINAL_CODEX = process.env.CODEX_SESSIONS_PATH
const ORIGINAL_COPILOT = process.env.COPILOT_SESSION_PATH

let tempHome

function pathToProjectId(absPath) {
  return '-' + absPath.replace(/^\/+/, '').replace(/[^a-zA-Z0-9-]/g, '-')
}

function makeFakeRes() {
  const events = []
  let buf = ''
  return {
    events,
    write(chunk) {
      buf += chunk
      while (true) {
        const idx = buf.indexOf('\n\n')
        if (idx < 0) break
        const block = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        const lines = block.split('\n')
        let event = null
        let data = null
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice('event:'.length).trim()
          else if (line.startsWith('data:')) data = line.slice('data:'.length).trim()
        }
        if (event) {
          let parsed = null
          if (data) {
            try { parsed = JSON.parse(data) } catch (e) { parsed = data }
          }
          events.push({ event, data: parsed })
        }
      }
      return true
    },
    on() { /* noop */ }
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function eventsFor(res, type) {
  return res.events.filter((e) => e.event === type)
}

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'list-watcher-'))
  process.env.HOME = tempHome
  delete process.env.CLAUDE_PROJECTS_PATH
  delete process.env.CODEX_SESSIONS_PATH
  delete process.env.COPILOT_SESSION_PATH
  clearAgentHomeDiscoveryCache()
  clearCopilotDiscoveryCache()
})

afterEach(() => {
  priv.clearForTest()
  clearAgentHomeDiscoveryCache()
  clearCopilotDiscoveryCache()
  if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true })
  if (ORIGINAL_HOME === undefined) delete process.env.HOME
  else process.env.HOME = ORIGINAL_HOME
  if (ORIGINAL_CLAUDE === undefined) delete process.env.CLAUDE_PROJECTS_PATH
  else process.env.CLAUDE_PROJECTS_PATH = ORIGINAL_CLAUDE
  if (ORIGINAL_CODEX === undefined) delete process.env.CODEX_SESSIONS_PATH
  else process.env.CODEX_SESSIONS_PATH = ORIGINAL_CODEX
  if (ORIGINAL_COPILOT === undefined) delete process.env.COPILOT_SESSION_PATH
  else process.env.COPILOT_SESSION_PATH = ORIGINAL_COPILOT
})

const FLUSH_BUDGET_MS = 1200

describe('list watcher: claudecode', () => {
  it('emits sessions_changed when a jsonl is dropped into an existing project', async () => {
    const root = path.join(tempHome, '.claude', 'projects')
    const projectId = '-fake-proj'
    fs.mkdirSync(path.join(root, projectId), { recursive: true })

    const res = makeFakeRes()
    await subscribeListEvents(res)

    fs.writeFileSync(path.join(root, projectId, 'fresh.jsonl'), '{}\n')
    await wait(FLUSH_BUDGET_MS)

    const sessions = eventsFor(res, 'sessions_changed')
    const projects = eventsFor(res, 'projects_changed')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].data).toEqual({ projectId })
    expect(projects).toHaveLength(0)

    unsubscribeListEvents(res)
  })

  it('emits both projects_changed and sessions_changed when a new project subdir appears', async () => {
    const root = path.join(tempHome, '.claude', 'projects')
    fs.mkdirSync(root, { recursive: true })

    const res = makeFakeRes()
    await subscribeListEvents(res)

    const newProjectId = '-new-proj'
    fs.mkdirSync(path.join(root, newProjectId), { recursive: true })
    fs.writeFileSync(path.join(root, newProjectId, 'fresh.jsonl'), '{}\n')
    await wait(FLUSH_BUDGET_MS)

    expect(eventsFor(res, 'projects_changed')).toHaveLength(1)
    const sessions = eventsFor(res, 'sessions_changed')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].data).toEqual({ projectId: newProjectId })

    unsubscribeListEvents(res)
  })

  it('delivers events to multiple subscribers', async () => {
    const root = path.join(tempHome, '.claude', 'projects')
    const projectId = '-multi-sub-proj'
    fs.mkdirSync(path.join(root, projectId), { recursive: true })

    const a = makeFakeRes()
    const b = makeFakeRes()
    await subscribeListEvents(a)
    await subscribeListEvents(b)

    fs.writeFileSync(path.join(root, projectId, 'session.jsonl'), '{}\n')
    await wait(FLUSH_BUDGET_MS)

    expect(eventsFor(a, 'sessions_changed')).toHaveLength(1)
    expect(eventsFor(b, 'sessions_changed')).toHaveLength(1)

    unsubscribeListEvents(a)
    unsubscribeListEvents(b)
  })

  it('tears down all watchers when the last subscriber unsubscribes', async () => {
    fs.mkdirSync(path.join(tempHome, '.claude', 'projects'), { recursive: true })
    const res = makeFakeRes()
    await subscribeListEvents(res)
    expect(priv.getWatcherCount()).toBeGreaterThan(0)

    unsubscribeListEvents(res)
    expect(priv.getWatcherCount()).toBe(0)
    // clearForTest should be a no-op afterwards
    priv.clearForTest()
    expect(priv.getWatcherCount()).toBe(0)
  })

  it('dedupes symlinked roots so a single jsonl change produces only one event', async () => {
    // Real directory backing the canonical home.
    const realRoot = path.join(tempHome, '.claude')
    fs.mkdirSync(path.join(realRoot, 'projects'), { recursive: true })
    // .claudew-link points to .claude — same realpath.
    fs.symlinkSync(realRoot, path.join(tempHome, '.claudew-link'))

    const projectId = '-dedupe-proj'
    fs.mkdirSync(path.join(realRoot, 'projects', projectId), { recursive: true })

    const res = makeFakeRes()
    await subscribeListEvents(res)

    fs.writeFileSync(path.join(realRoot, 'projects', projectId, 'session.jsonl'), '{}\n')
    await wait(FLUSH_BUDGET_MS)

    const sessions = eventsFor(res, 'sessions_changed').filter((e) => e.data.projectId === projectId)
    expect(sessions).toHaveLength(1)

    unsubscribeListEvents(res)
  })

  it('debounces bursts of file writes into a single sessions_changed event', async () => {
    const root = path.join(tempHome, '.claude', 'projects')
    const projectId = '-burst-proj'
    fs.mkdirSync(path.join(root, projectId), { recursive: true })

    const res = makeFakeRes()
    await subscribeListEvents(res)

    fs.writeFileSync(path.join(root, projectId, 'a.jsonl'), '{}\n')
    fs.writeFileSync(path.join(root, projectId, 'b.jsonl'), '{}\n')
    fs.writeFileSync(path.join(root, projectId, 'c.jsonl'), '{}\n')

    await wait(FLUSH_BUDGET_MS)

    const sessions = eventsFor(res, 'sessions_changed').filter((e) => e.data.projectId === projectId)
    expect(sessions).toHaveLength(1)

    unsubscribeListEvents(res)
  })

  it('ignores non-jsonl files in a project directory', async () => {
    const root = path.join(tempHome, '.claude', 'projects')
    const projectId = '-filter-proj'
    fs.mkdirSync(path.join(root, projectId), { recursive: true })

    const res = makeFakeRes()
    await subscribeListEvents(res)

    fs.writeFileSync(path.join(root, projectId, 'notes.txt'), 'hello')
    await wait(FLUSH_BUDGET_MS)

    expect(res.events).toHaveLength(0)

    unsubscribeListEvents(res)
  })
})

describe('list watcher: codex', () => {
  it('derives projectId from rollout session_meta and flags as new project', async () => {
    const sessionsRoot = path.join(tempHome, '.codex', 'sessions', '2026', '05', '20')
    fs.mkdirSync(sessionsRoot, { recursive: true })

    const res = makeFakeRes()
    await subscribeListEvents(res)

    const meta = {
      type: 'session_meta',
      payload: { id: 'codex-x', cwd: '/tmp/proj-x' }
    }
    fs.writeFileSync(
      path.join(sessionsRoot, 'rollout-x.jsonl'),
      JSON.stringify(meta) + '\n'
    )

    await wait(FLUSH_BUDGET_MS)

    const projectId = pathToProjectId('/tmp/proj-x')
    const sessions = eventsFor(res, 'sessions_changed').filter((e) => e.data.projectId === projectId)
    const projects = eventsFor(res, 'projects_changed')

    expect(sessions).toHaveLength(1)
    expect(projects.length).toBeGreaterThanOrEqual(1)

    unsubscribeListEvents(res)
  })

  it('evicts the codex cache entry on unlink', async () => {
    const sessionsRoot = path.join(tempHome, '.codex', 'sessions', '2026', '05', '20')
    fs.mkdirSync(sessionsRoot, { recursive: true })

    const filePath = path.join(sessionsRoot, 'rollout-evict.jsonl')
    fs.writeFileSync(filePath, JSON.stringify({
      type: 'session_meta',
      payload: { id: 'codex-evict', cwd: '/tmp/proj-evict' }
    }) + '\n')

    const res = makeFakeRes()
    await subscribeListEvents(res)
    // File existed at seed time → cached by seedKnownProjectIds.
    expect(priv.codexProjectPathCache.has(filePath)).toBe(true)

    fs.unlinkSync(filePath)
    await wait(FLUSH_BUDGET_MS)

    expect(priv.codexProjectPathCache.has(filePath)).toBe(false)

    unsubscribeListEvents(res)
  })
})

describe('list watcher: gcopilot', () => {
  it('drops events when workspace.yaml is missing/malformed', async () => {
    const root = path.join(tempHome, '.copilot', 'session-state')
    const sessionDir = path.join(root, 'session-broken')
    fs.mkdirSync(sessionDir, { recursive: true })
    // Intentionally no workspace.yaml; touch events.jsonl after subscribing.
    fs.writeFileSync(path.join(sessionDir, 'events.jsonl'), '{}\n')

    const res = makeFakeRes()
    await subscribeListEvents(res)

    fs.appendFileSync(path.join(sessionDir, 'events.jsonl'), '{}\n')
    await wait(FLUSH_BUDGET_MS)

    expect(res.events).toHaveLength(0)

    unsubscribeListEvents(res)
  })
})

describe('list watcher: lifecycle and race', () => {
  it('single-flights concurrent first subscribers', async () => {
    fs.mkdirSync(path.join(tempHome, '.claude', 'projects'), { recursive: true })

    const a = makeFakeRes()
    const b = makeFakeRes()
    const pA = subscribeListEvents(a)
    const pB = subscribeListEvents(b)
    await Promise.all([pA, pB])

    // Only one watcher per realpath (claudecode root).
    expect(priv.getWatcherCount()).toBe(1)

    unsubscribeListEvents(a)
    unsubscribeListEvents(b)
  })

  it('does not deliver events flushed before a subscriber connects', async () => {
    const root = path.join(tempHome, '.claude', 'projects')
    const projectId = '-late-join'
    fs.mkdirSync(path.join(root, projectId), { recursive: true })

    const a = makeFakeRes()
    await subscribeListEvents(a)

    fs.writeFileSync(path.join(root, projectId, 'a.jsonl'), '{}\n')
    await wait(FLUSH_BUDGET_MS)

    expect(eventsFor(a, 'sessions_changed').length).toBeGreaterThan(0)

    // B joins after the flush already happened.
    const b = makeFakeRes()
    await subscribeListEvents(b)
    expect(b.events).toHaveLength(0)

    // B should still receive future events.
    fs.writeFileSync(path.join(root, projectId, 'b.jsonl'), '{}\n')
    await wait(FLUSH_BUDGET_MS)

    expect(eventsFor(b, 'sessions_changed').length).toBeGreaterThan(0)

    unsubscribeListEvents(a)
    unsubscribeListEvents(b)
  })

  it('tears watchers down if the only subscriber leaves during init', async () => {
    fs.mkdirSync(path.join(tempHome, '.claude', 'projects'), { recursive: true })

    const res = makeFakeRes()
    const subscribePromise = subscribeListEvents(res)
    // Simulate the client disconnecting mid-init: the route handler's res.on('close')
    // fires unsubscribe before subscribeListEvents resolves.
    unsubscribeListEvents(res)
    await subscribePromise

    // No subscribers remain — listWatcher must have torn the freshly-attached
    // watchers down rather than leaving them idle with zero consumers.
    expect(priv.subscribers.size).toBe(0)
    expect(priv.getWatcherCount()).toBe(0)
  })
})

describe('list watcher: gcopilot structural events', () => {
  it('does not fire projects_changed for an addDir when workspace.yaml is missing', async () => {
    const root = path.join(tempHome, '.copilot', 'session-state')
    fs.mkdirSync(root, { recursive: true })

    const res = makeFakeRes()
    await subscribeListEvents(res)

    // New session dir appears with no workspace.yaml — projectId undeterminable.
    fs.mkdirSync(path.join(root, 'session-new-broken'), { recursive: true })
    await wait(FLUSH_BUDGET_MS)

    expect(eventsFor(res, 'projects_changed')).toHaveLength(0)
    expect(eventsFor(res, 'sessions_changed')).toHaveLength(0)

    unsubscribeListEvents(res)
  })
})
