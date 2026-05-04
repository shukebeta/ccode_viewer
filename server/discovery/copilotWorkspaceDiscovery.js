const fs = require('fs').promises
const path = require('path')
const os = require('os')

const DEFAULT_COPILOT_SESSION_PATH = path.join(os.homedir(), '.copilot', 'session-state')

function getCopilotSessionRoots(env = process.env) {
  const configuredRoot = env.COPILOT_SESSION_PATH
  return configuredRoot ? [configuredRoot] : [DEFAULT_COPILOT_SESSION_PATH]
}

function getCopilotSessionPath(env = process.env) {
  return getCopilotSessionRoots(env)[0]
}

function isLegacyCopilotSessionFile(entry, pathImpl = path) {
  return entry.isFile() && pathImpl.extname(entry.name).toLowerCase() === '.jsonl'
}

function isCopilotSessionEntry(entry, pathImpl = path) {
  return entry.isDirectory() || isLegacyCopilotSessionFile(entry, pathImpl)
}

function parseSimpleYaml(text) {
  const result = {}
  for (const line of text.split('\n')) {
    const match = line.match(/^(\w[\w_]*):\s*(.+)$/)
    if (match) result[match[1]] = match[2].trim()
  }
  return result
}

async function readCopilotWorkspace(sessionDir, deps = {}) {
  const fsModule = deps.fsModule || fs
  const pathModule = deps.pathModule || path

  try {
    const content = await fsModule.readFile(pathModule.join(sessionDir, 'workspace.yaml'), 'utf8')
    return parseSimpleYaml(content)
  } catch (e) {
    return null
  }
}

async function extractCopilotProjectPath(sessionFilePath, deps = {}) {
  const fsModule = deps.fsModule || fs

  try {
    const content = await fsModule.readFile(sessionFilePath, 'utf8')
    const lines = content.trim().split('\n')

    for (const line of lines) {
      try {
        const data = JSON.parse(line)
        const directPath = data?.data?.arguments?.path
        const toolRequests = Array.isArray(data?.data?.toolRequests) ? data.data.toolRequests : []
        const requestPath = toolRequests.find((request) => request?.arguments?.path)?.arguments?.path
        const candidatePath = directPath || requestPath

        if (!candidatePath || typeof candidatePath !== 'string') continue

        if (/^[A-Za-z]:\\/.test(candidatePath) || /^[A-Za-z]:\//.test(candidatePath)) {
          const normalizedWindowsPath = candidatePath.replace(/\//g, '\\')
          const parts = normalizedWindowsPath.split('\\')
          if (parts.length > 4) return path.win32.join(...parts.slice(0, 4))
          return normalizedWindowsPath
        }

        if (candidatePath.startsWith('/')) {
          const normalizedPosixPath = candidatePath.replace(/\\/g, '/')
          const parts = normalizedPosixPath.split('/').filter(Boolean)
          if (parts.length > 3) return `/${parts.slice(0, 3).join('/')}`
          return normalizedPosixPath
        }
      } catch (e) {
        // Skip invalid JSON lines
      }
    }

    return null
  } catch (e) {
    return null
  }
}

async function resolveSessionFilePath(filePath, deps = {}) {
  const fsModule = deps.fsModule || fs
  const pathModule = deps.pathModule || path
  const stat = await fsModule.stat(filePath)
  if (!stat.isDirectory()) return filePath
  return pathModule.join(filePath, 'events.jsonl')
}

async function resolveCopilotProjectPath(sessionPath, deps = {}) {
  const fsModule = deps.fsModule || fs
  const pathModule = deps.pathModule || path

  try {
    const stat = await fsModule.stat(sessionPath)
    if (stat.isDirectory()) {
      const workspace = await readCopilotWorkspace(sessionPath, deps)
      if (workspace?.cwd) return workspace.cwd

      try {
        const sessionFile = await resolveSessionFilePath(sessionPath, deps)
        return await extractCopilotProjectPath(sessionFile, deps)
      } catch (e) {
        return null
      }
    }

    if (pathModule.extname(sessionPath).toLowerCase() === '.jsonl') {
      return await extractCopilotProjectPath(sessionPath, deps)
    }
  } catch (e) {
    return null
  }

  return null
}

async function getSessionLastUpdated(sessionPath, sessionFilePath, deps = {}) {
  const fsModule = deps.fsModule || fs

  try {
    return (await fsModule.stat(sessionFilePath)).mtime
  } catch (e) {
    return (await fsModule.stat(sessionPath)).mtime
  }
}

async function discoverCopilotWorkspaces(options = {}) {
  const fsModule = options.fsModule || fs
  const pathModule = options.pathModule || path
  const rootPaths = options.rootPaths || getCopilotSessionRoots(options.env)
  const discoveries = []

  for (const rootPath of rootPaths) {
    try {
      const entries = await fsModule.readdir(rootPath, { withFileTypes: true })

      for (const entry of entries) {
        if (!isCopilotSessionEntry(entry, pathModule)) continue

        const sessionPath = pathModule.join(rootPath, entry.name)
        const projectPath = await resolveCopilotProjectPath(sessionPath, {
          fsModule,
          pathModule
        })
        if (!projectPath) continue

        const sessionFilePath = await resolveSessionFilePath(sessionPath, {
          fsModule,
          pathModule
        })
        const workspace = entry.isDirectory()
          ? await readCopilotWorkspace(sessionPath, { fsModule, pathModule })
          : null
        const lastUpdated = await getSessionLastUpdated(sessionPath, sessionFilePath, {
          fsModule,
          pathModule
        })

        discoveries.push({
          rootPath,
          entryName: entry.name,
          sessionPath,
          sessionFilePath,
          projectPath,
          workspace,
          lastUpdated,
          isLegacyFile: isLegacyCopilotSessionFile(entry, pathModule)
        })
      }
    } catch (e) {
      // Source root doesn't exist or can't be read.
    }
  }

  return discoveries
}

module.exports = {
  DEFAULT_COPILOT_SESSION_PATH,
  getCopilotSessionRoots,
  getCopilotSessionPath,
  readCopilotWorkspace,
  extractCopilotProjectPath,
  resolveSessionFilePath,
  resolveCopilotProjectPath,
  discoverCopilotWorkspaces
}
