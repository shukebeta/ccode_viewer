import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getProjects, getSessions } from '../fsHelpers'
import { clearCopilotDiscoveryCache } from '../discovery/copilotWorkspaceDiscovery'
import { clearAgentHomeDiscoveryCache } from '../discovery/agentHomeDiscovery'

const ORIGINAL_HOME = process.env.HOME
const ORIGINAL_CLAUDE_PROJECTS_PATH = process.env.CLAUDE_PROJECTS_PATH
const ORIGINAL_COPILOT_SESSION_PATH = process.env.COPILOT_SESSION_PATH
const ORIGINAL_CODEX_SESSIONS_PATH = process.env.CODEX_SESSIONS_PATH

let tempHome

function pathToProjectId(absPath) {
  return '-' + absPath.replace(/^\/+/, '').replace(/[^a-zA-Z0-9-]/g, '-')
}

function makeClaudeSession(projectsRoot, projectId, sessionFileName, messages) {
  const projectDir = path.join(projectsRoot, projectId)
  fs.mkdirSync(projectDir, { recursive: true })
  const sessionPath = path.join(projectDir, sessionFileName)
  fs.writeFileSync(sessionPath, messages.map((m) => JSON.stringify(m)).join('\n'), 'utf8')
  return sessionPath
}

function makeCodexSession(sessionsRoot, fileName, lines) {
  fs.mkdirSync(sessionsRoot, { recursive: true })
  const sessionPath = path.join(sessionsRoot, fileName)
  fs.writeFileSync(sessionPath, lines.map((l) => JSON.stringify(l)).join('\n'), 'utf8')
  return sessionPath
}

function makeCopilotSession(stateRoot, dirName, workspaceCwd, eventLines) {
  const sessionDir = path.join(stateRoot, dirName)
  fs.mkdirSync(sessionDir, { recursive: true })
  fs.writeFileSync(path.join(sessionDir, 'workspace.yaml'), `cwd: ${workspaceCwd}\n`, 'utf8')
  fs.writeFileSync(
    path.join(sessionDir, 'events.jsonl'),
    eventLines.map((l) => JSON.stringify(l)).join('\n'),
    'utf8'
  )
  return sessionDir
}

function userMsg(text, timestamp) {
  return {
    type: 'user',
    uuid: `u-${text}-${timestamp}`,
    timestamp,
    message: { content: text }
  }
}

function assistantMsg(text, timestamp) {
  return {
    type: 'assistant',
    uuid: `a-${text}-${timestamp}`,
    timestamp,
    message: { content: text }
  }
}

function threeMessageClaudeSession() {
  return [
    userMsg('hi', '2026-05-01T00:00:00.000Z'),
    assistantMsg('hello', '2026-05-01T00:00:01.000Z'),
    userMsg('thanks', '2026-05-01T00:00:02.000Z')
  ]
}

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccode-multihome-'))
  process.env.HOME = tempHome
  delete process.env.CLAUDE_PROJECTS_PATH
  delete process.env.COPILOT_SESSION_PATH
  delete process.env.CODEX_SESSIONS_PATH
  clearCopilotDiscoveryCache()
  clearAgentHomeDiscoveryCache()
})

afterEach(() => {
  clearCopilotDiscoveryCache()
  clearAgentHomeDiscoveryCache()
  if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true })
  if (ORIGINAL_HOME === undefined) delete process.env.HOME
  else process.env.HOME = ORIGINAL_HOME
  if (ORIGINAL_CLAUDE_PROJECTS_PATH === undefined) delete process.env.CLAUDE_PROJECTS_PATH
  else process.env.CLAUDE_PROJECTS_PATH = ORIGINAL_CLAUDE_PROJECTS_PATH
  if (ORIGINAL_COPILOT_SESSION_PATH === undefined) delete process.env.COPILOT_SESSION_PATH
  else process.env.COPILOT_SESSION_PATH = ORIGINAL_COPILOT_SESSION_PATH
  if (ORIGINAL_CODEX_SESSIONS_PATH === undefined) delete process.env.CODEX_SESSIONS_PATH
  else process.env.CODEX_SESSIONS_PATH = ORIGINAL_CODEX_SESSIONS_PATH
})

describe('multi-home Claude discovery', () => {
  it('sums sessionCount.claudecode across two distinct .claude* roots', async () => {
    const canonicalRoot = path.join(tempHome, '.claude', 'projects')
    const variantRoot = path.join(tempHome, '.claudew-plan', 'projects')
    fs.mkdirSync(canonicalRoot, { recursive: true })
    fs.mkdirSync(variantRoot, { recursive: true })

    const projectId = pathToProjectId('/tmp/multihome-claude-sums')
    makeClaudeSession(canonicalRoot, projectId, 'canonical.jsonl', threeMessageClaudeSession())
    makeClaudeSession(variantRoot, projectId, 'variant.jsonl', threeMessageClaudeSession())

    const projects = await getProjects()
    const project = projects.find((p) => p.id === projectId)
    expect(project).toBeDefined()
    expect(project.sessionCount.claudecode).toBe(2)
    expect(project.sourceHomes?.claudecode || []).toEqual(['.claudew-plan'])
  })

  it('reads sessions from a non-canonical .claude* root with sourceHome attached', async () => {
    const variantRoot = path.join(tempHome, '.claudew', 'projects')
    fs.mkdirSync(variantRoot, { recursive: true })
    fs.mkdirSync(path.join(tempHome, '.claude'), { recursive: true }) // no projects subdir

    const projectId = pathToProjectId('/tmp/multihome-claude-variant-only')
    makeClaudeSession(variantRoot, projectId, 'variant.jsonl', threeMessageClaudeSession())

    const sessions = await getSessions(projectId)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].sourceHome).toBe('.claudew')
    expect(sessions[0].source).toBe('claudecode')
  })

  it('omits sourceHome on canonical .claude sessions', async () => {
    const canonicalRoot = path.join(tempHome, '.claude', 'projects')
    fs.mkdirSync(canonicalRoot, { recursive: true })

    const projectId = pathToProjectId('/tmp/multihome-claude-canonical-only')
    makeClaudeSession(canonicalRoot, projectId, 'canonical.jsonl', threeMessageClaudeSession())

    const sessions = await getSessions(projectId)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].sourceHome).toBeUndefined()
  })
})

describe('multi-home Codex discovery', () => {
  it('aggregates Codex sessionCount and sourceHomes across two .codex* roots', async () => {
    const codexCanonical = path.join(tempHome, '.codex', 'sessions')
    const codexPlan = path.join(tempHome, '.codex-plan', 'sessions')
    const workspaceCwd = '/tmp/multihome-codex-project'

    const meta = (id, branch) => ({
      timestamp: '2026-05-02T00:00:00.000Z',
      type: 'session_meta',
      payload: {
        id,
        timestamp: '2026-05-02T00:00:00.000Z',
        cwd: workspaceCwd,
        git: { branch }
      }
    })

    makeCodexSession(codexCanonical, 'rollout-canon.jsonl', [
      meta('codex-canon', 'main'),
      {
        timestamp: '2026-05-02T00:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hello from canon' }]
        }
      }
    ])
    makeCodexSession(codexPlan, 'rollout-plan.jsonl', [
      meta('codex-plan', 'planning'),
      {
        timestamp: '2026-05-02T00:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hello from plan' }]
        }
      }
    ])

    const projects = await getProjects()
    const projectId = pathToProjectId(workspaceCwd)
    const project = projects.find((p) => p.id === projectId)
    expect(project).toBeDefined()
    expect(project.sessionCount.codex).toBe(2)
    expect(project.sourceHomes?.codex || []).toEqual(['.codex-plan'])
  })
})

describe('env override sentinel does not leak', () => {
  it('CLAUDE_PROJECTS_PATH override emits no sourceHome on sessions or projects', async () => {
    const overrideRoot = path.join(tempHome, 'override-projects')
    fs.mkdirSync(overrideRoot, { recursive: true })
    process.env.CLAUDE_PROJECTS_PATH = overrideRoot

    const projectId = pathToProjectId('/tmp/multihome-override')
    makeClaudeSession(overrideRoot, projectId, 'session.jsonl', threeMessageClaudeSession())

    const projects = await getProjects()
    const project = projects.find((p) => p.id === projectId)
    expect(project).toBeDefined()
    expect(project.sourceHomes).toBeUndefined()

    const sessions = await getSessions(projectId)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].sourceHome).toBeUndefined()
  })
})

describe('multi-home Copilot attribution', () => {
  it('attaches sourceHome on non-canonical Copilot sessions and omits it on canonical', async () => {
    const canonicalRoot = path.join(tempHome, '.copilot', 'session-state')
    const variantRoot = path.join(tempHome, '.copilot-plan', 'session-state')
    const workspaceCwd = '/tmp/multihome-copilot-project'

    const events = [
      { type: 'session.start', data: { sessionId: 's-canon' }, timestamp: '2026-05-02T00:00:00.000Z' },
      { type: 'user.message', data: { content: 'hello' }, timestamp: '2026-05-02T00:00:01.000Z' },
      { type: 'assistant.message', data: { content: 'hi' }, timestamp: '2026-05-02T00:00:02.000Z' },
      { type: 'user.message', data: { content: 'thanks' }, timestamp: '2026-05-02T00:00:03.000Z' }
    ]
    const planEvents = events.map((e, i) =>
      i === 0 ? { ...e, data: { sessionId: 's-plan' } } : e
    )

    makeCopilotSession(canonicalRoot, 'session-canon', workspaceCwd, events)
    makeCopilotSession(variantRoot, 'session-plan', workspaceCwd, planEvents)

    const projectId = pathToProjectId(workspaceCwd)
    const sessions = await getSessions(projectId)
    expect(sessions).toHaveLength(2)

    const canonicalSession = sessions.find((s) => s.id === 's-canon')
    const variantSession = sessions.find((s) => s.id === 's-plan')

    expect(canonicalSession).toBeDefined()
    expect(canonicalSession.sourceHome).toBeUndefined()

    expect(variantSession).toBeDefined()
    expect(variantSession.sourceHome).toBe('.copilot-plan')
  })
})
