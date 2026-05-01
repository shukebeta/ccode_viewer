import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'

import { getProjects } from '../fsHelpers'

const createdSessionDirs = []
const createdProjectDirs = []
const createdWorkspaces = []

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
})

describe('getProjects', () => {
  it('prefers an existing hyphenated directory over splitting into nested directories', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const workspaceRoot = path.join(os.tmpdir(), `ccode-viewer-project-root-${suffix}`)
    const nestedPrefixDir = path.join(workspaceRoot, 'gridai')
    const hyphenatedDir = path.join(workspaceRoot, 'gridai-auto-job')
    const projectId = hyphenatedDir.replace(/\\/g, '/').replace(/^\/+/, '-').replace(/[^a-zA-Z0-9-]/g, '-')
    const claudeProjectDir = path.join(os.homedir(), '.claude', 'projects', projectId)

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
    const copilotRoot = path.join(os.homedir(), '.copilot', 'session-state')
    fs.mkdirSync(copilotRoot, { recursive: true })

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
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
})
