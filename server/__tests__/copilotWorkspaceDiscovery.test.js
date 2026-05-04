const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  DEFAULT_COPILOT_SESSION_PATH,
  getCopilotSessionRoots,
  readCopilotWorkspace,
  resolveSessionFilePath,
  resolveCopilotProjectPath,
  discoverCopilotWorkspaces
} = require('../discovery/copilotWorkspaceDiscovery')

const createdDirs = []

function makeTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  createdDirs.push(dir)
  return dir
}

afterEach(() => {
  while (createdDirs.length > 0) {
    fs.rmSync(createdDirs.pop(), { recursive: true, force: true })
  }
})

describe('copilotWorkspaceDiscovery', () => {
  it('prefers the configured session root and otherwise falls back to the default root', () => {
    expect(getCopilotSessionRoots({ COPILOT_SESSION_PATH: '/tmp/copilot-root' })).toEqual(['/tmp/copilot-root'])
    expect(getCopilotSessionRoots({})).toEqual([DEFAULT_COPILOT_SESSION_PATH])
  })

  it('reads workspace metadata from directory-based Copilot sessions', async () => {
    const sessionDir = makeTempDir('copilot-discovery-workspace-')
    fs.writeFileSync(
      path.join(sessionDir, 'workspace.yaml'),
      'cwd: /tmp/linux-demo/project\nbranch: main\nsummary: test summary\n',
      'utf8'
    )

    await expect(readCopilotWorkspace(sessionDir)).resolves.toEqual({
      cwd: '/tmp/linux-demo/project',
      branch: 'main',
      summary: 'test summary'
    })
  })

  it('falls back to events.jsonl when a directory session has no workspace.yaml', async () => {
    const sessionDir = makeTempDir('copilot-discovery-fallback-')
    const eventsFile = path.join(sessionDir, 'events.jsonl')
    fs.writeFileSync(
      eventsFile,
      [
        JSON.stringify({
          type: 'tool.execution_start',
          data: {
            toolName: 'view',
            arguments: {
              path: '/tmp/linux-demo/project/src/index.js'
            }
          }
        })
      ].join('\n'),
      'utf8'
    )

    await expect(resolveSessionFilePath(sessionDir)).resolves.toBe(eventsFile)
    await expect(resolveCopilotProjectPath(sessionDir)).resolves.toBe('/tmp/linux-demo/project')
  })

  it('discovers both directory sessions and legacy jsonl sessions from configured roots', async () => {
    const root = makeTempDir('copilot-discovery-root-')

    const directorySession = path.join(root, 'session-dir')
    fs.mkdirSync(directorySession, { recursive: true })
    fs.writeFileSync(
      path.join(directorySession, 'workspace.yaml'),
      'cwd: /tmp/linux-demo/project-one\nbranch: feature/test\n',
      'utf8'
    )
    fs.writeFileSync(path.join(directorySession, 'events.jsonl'), '{}\n', 'utf8')

    const legacySession = path.join(root, 'legacy-session.jsonl')
    fs.writeFileSync(
      legacySession,
      [
        JSON.stringify({
          type: 'tool.execution_start',
          data: {
            toolName: 'view',
            arguments: {
              path: '/tmp/linux-demo/project-two/app/main.js'
            }
          }
        })
      ].join('\n'),
      'utf8'
    )

    const discoveries = await discoverCopilotWorkspaces({ rootPaths: [root] })

    expect(discoveries).toHaveLength(2)
    expect(discoveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rootPath: root,
          sessionPath: directorySession,
          sessionFilePath: path.join(directorySession, 'events.jsonl'),
          projectPath: '/tmp/linux-demo/project-one',
          workspace: expect.objectContaining({
            branch: 'feature/test'
          }),
          isLegacyFile: false
        }),
        expect.objectContaining({
          rootPath: root,
          sessionPath: legacySession,
          sessionFilePath: legacySession,
          projectPath: '/tmp/linux-demo/project-two',
          workspace: null,
          isLegacyFile: true
        })
      ])
    )
  })
})
