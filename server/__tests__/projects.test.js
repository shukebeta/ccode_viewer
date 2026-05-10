import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'

import { deleteSession, getProjects, getSessions } from '../fsHelpers'

const createdSessionDirs = []
const createdProjectDirs = []
const createdWorkspaces = []
const createdSourceRoots = []
const originalClaudeProjectsPath = process.env.CLAUDE_PROJECTS_PATH
const originalCopilotSessionPath = process.env.COPILOT_SESSION_PATH
const originalCodexSessionsPath = process.env.CODEX_SESSIONS_PATH

function configureSourceRoots(suffix) {
  const root = path.join(os.tmpdir(), `ccode-viewer-source-roots-${suffix}`)
  const claudeRoot = path.join(root, 'claude-projects')
  const copilotRoot = path.join(root, 'copilot-session-state')
  const codexRoot = path.join(root, 'codex-sessions')

  process.env.CLAUDE_PROJECTS_PATH = claudeRoot
  process.env.COPILOT_SESSION_PATH = copilotRoot
  process.env.CODEX_SESSIONS_PATH = codexRoot

  createdSourceRoots.push(root)
  return { claudeRoot, copilotRoot, codexRoot }
}

afterEach(() => {
  while (createdSessionDirs.length > 0) {
    const sessionDir = createdSessionDirs.pop()
    fs.rmSync(sessionDir, { recursive: true, force: true })
  }
  while (createdProjectDirs.length > 0) {
    const projectDir = createdProjectDirs.pop()
    fs.rmSync(projectDir, { recursive: true, force: true })
  }
  while (createdWorkspaces.length > 0) {
    const workspaceDir = createdWorkspaces.pop()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  }
  while (createdSourceRoots.length > 0) {
    const rootDir = createdSourceRoots.pop()
    fs.rmSync(rootDir, { recursive: true, force: true })
  }

  if (originalClaudeProjectsPath === undefined) delete process.env.CLAUDE_PROJECTS_PATH
  else process.env.CLAUDE_PROJECTS_PATH = originalClaudeProjectsPath
  if (originalCopilotSessionPath === undefined) delete process.env.COPILOT_SESSION_PATH
  else process.env.COPILOT_SESSION_PATH = originalCopilotSessionPath
  if (originalCodexSessionsPath === undefined) delete process.env.CODEX_SESSIONS_PATH
  else process.env.CODEX_SESSIONS_PATH = originalCodexSessionsPath
})

describe('getProjects', () => {
  it('prefers an existing hyphenated directory over splitting into nested directories', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const { claudeRoot } = configureSourceRoots(suffix)
    const workspaceRoot = path.join(os.tmpdir(), `ccode-viewer-project-root-${suffix}`)
    const nestedPrefixDir = path.join(workspaceRoot, 'gridai')
    const hyphenatedDir = path.join(workspaceRoot, 'gridai-auto-job')
    const projectId = hyphenatedDir.replace(/\\/g, '/').replace(/^\/+/, '-').replace(/[^a-zA-Z0-9-]/g, '-')
    const claudeProjectDir = path.join(claudeRoot, projectId)
    fs.mkdirSync(claudeRoot, { recursive: true })

    fs.mkdirSync(nestedPrefixDir, { recursive: true })
    fs.mkdirSync(hyphenatedDir, { recursive: true })
    fs.mkdirSync(claudeProjectDir, { recursive: true })

    createdWorkspaces.push(workspaceRoot)
    createdProjectDirs.push(claudeProjectDir)

    const projects = await getProjects()
    const project = projects.find((entry) => entry.id === projectId)

    expect(project).toBeDefined()
    expect(project).toMatchObject({
      id: projectId,
      name: hyphenatedDir,
      path: claudeProjectDir
    })
  })

  it('uses Copilot workspace cwd for Copilot-only project names with hyphens', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const { copilotRoot } = configureSourceRoots(suffix)
    fs.mkdirSync(copilotRoot, { recursive: true })
    const sessionDir = path.join(copilotRoot, `ccode-viewer-projects-test-${suffix}`)
    const workspaceCwd = `/tmp/ccode-viewer-gridai-auto-job-regression-${suffix}/gridai-auto-job`
    const projectId = '-tmp-ccode-viewer-gridai-auto-job-regression-' +
      `${suffix.replace(/[^a-zA-Z0-9-]/g, '-')}-gridai-auto-job`

    fs.mkdirSync(sessionDir, { recursive: true })
    fs.writeFileSync(
      path.join(sessionDir, 'workspace.yaml'),
      `cwd: ${workspaceCwd}\n`,
      'utf8'
    )
    createdSessionDirs.push(sessionDir)

    const projects = await getProjects()
    const project = projects.find((entry) => entry.id === projectId)

    expect(project).toBeDefined()
    expect(project).toMatchObject({
      id: projectId,
      name: workspaceCwd,
      path: workspaceCwd
    })
  })

  it('uses Codex session cwd for Codex-only project names with hyphens', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const { codexRoot } = configureSourceRoots(suffix)
    fs.mkdirSync(codexRoot, { recursive: true })
    const sessionDir = path.join(codexRoot, `ccode-viewer-codex-projects-test-${suffix}`)
    const workspaceCwd = `/tmp/ccode-viewer-codex-project-${suffix}/gridai-auto-job`
    const projectId = workspaceCwd.replace(/\\/g, '/').replace(/^\/+/, '-').replace(/[^a-zA-Z0-9-]/g, '-')

    fs.mkdirSync(sessionDir, { recursive: true })
    fs.writeFileSync(
      path.join(sessionDir, `rollout-${suffix}.jsonl`),
      [
        JSON.stringify({
          timestamp: '2026-05-02T00:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: `codex-project-${suffix}`,
            timestamp: '2026-05-02T00:00:00.000Z',
            cwd: workspaceCwd
          }
        }),
        JSON.stringify({
          timestamp: '2026-05-02T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'hello from codex' }]
          }
        })
      ].join('\n'),
      'utf8'
    )
    createdSessionDirs.push(sessionDir)

    const projects = await getProjects()
    const project = projects.find((entry) => entry.id === projectId)

    expect(project).toBeDefined()
    expect(project).toMatchObject({
      id: projectId,
      name: workspaceCwd,
      path: workspaceCwd
    })
    expect(project.sources).toContain('codex')
  })

  it('drops deleted Copilot-only projects immediately after session deletion', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const { copilotRoot } = configureSourceRoots(suffix)
    fs.mkdirSync(copilotRoot, { recursive: true })
    const sessionDir = path.join(copilotRoot, `ccode-viewer-delete-test-${suffix}`)
    const workspaceCwd = `/tmp/ccode-viewer-delete-test-${suffix}/gridai-auto-job`
    const projectId = workspaceCwd.replace(/\\/g, '/').replace(/^\/+/, '-').replace(/[^a-zA-Z0-9-]/g, '-')

    fs.mkdirSync(sessionDir, { recursive: true })
    fs.writeFileSync(
      path.join(sessionDir, 'workspace.yaml'),
      `cwd: ${workspaceCwd}\n`,
      'utf8'
    )
    fs.writeFileSync(path.join(sessionDir, 'events.jsonl'), '{}\n', 'utf8')
    createdSessionDirs.push(sessionDir)

    const beforeDelete = await getProjects()
    expect(beforeDelete.find((entry) => entry.id === projectId)).toBeDefined()

    await deleteSession(sessionDir)

    const afterDelete = await getProjects()
    expect(afterDelete.find((entry) => entry.id === projectId)).toBeUndefined()
  })
})

describe('getSessions', () => {
  it('lists Codex sessions with sanitized previews', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const { codexRoot } = configureSourceRoots(suffix)
    fs.mkdirSync(codexRoot, { recursive: true })
    const sessionDir = path.join(codexRoot, `ccode-viewer-codex-sessions-test-${suffix}`)
    const workspaceCwd = `/tmp/ccode-viewer-codex-sessions-${suffix}/gridai-auto-job`
    const projectId = workspaceCwd.replace(/\\/g, '/').replace(/^\/+/, '-').replace(/[^a-zA-Z0-9-]/g, '-')

    fs.mkdirSync(sessionDir, { recursive: true })
    fs.writeFileSync(
      path.join(sessionDir, `rollout-${suffix}.jsonl`),
      [
        JSON.stringify({
          timestamp: '2026-05-02T00:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: `codex-session-${suffix}`,
            timestamp: '2026-05-02T00:00:00.000Z',
            cwd: workspaceCwd
          }
        }),
        JSON.stringify({
          timestamp: '2026-05-02T00:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: '<environment_context>\n  <cwd>/tmp/demo</cwd>\n</environment_context>'
              },
              { type: 'input_text', text: 'real codex question' }
            ]
          }
        }),
        JSON.stringify({
          timestamp: '2026-05-02T00:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'assistant reply' }]
          }
        }),
        JSON.stringify({
          timestamp: '2026-05-02T00:00:03.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'follow up question' }]
          }
        })
      ].join('\n'),
      'utf8'
    )
    createdSessionDirs.push(sessionDir)

    const sessions = await getSessions(projectId)
    const session = sessions.find((entry) => entry.id === `codex-session-${suffix}`)

    expect(session).toBeDefined()
    expect(session).toMatchObject({
      source: 'codex',
      filePath: path.join(sessionDir, `rollout-${suffix}.jsonl`)
    })
    expect(session.preview).toContain('real codex question')
    expect(session.preview).not.toContain('environment_context')
  })
})
