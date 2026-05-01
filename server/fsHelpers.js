const fs = require('fs').promises
const path = require('path')
const os = require('os')
const { getUserPreviewText } = require('../shared/messageContent')

const CLAUDE_PROJECTS_PATH = path.join(os.homedir(), '.claude', 'projects')
const COPILOT_SESSION_PATH = path.join(os.homedir(), '.copilot', 'session-state')

// Local copy of resolveProjectPath (ported from electron/pathResolver.ts)
const { sep: PATH_SEP } = path
function resolveProjectPath(projectName, pathImpl = path) {
  const pathCache = resolveProjectPath._cache || (resolveProjectPath._cache = new Map())
  
  // Check cache
  if (pathCache.has(projectName)) {
    return pathCache.get(projectName)
  }

  // Empty string or only '-' case
  if (!projectName || projectName === '-') {
    const result = pathImpl.resolve(pathImpl.sep)
    pathCache.set(projectName, result)
    return result
  }

  // Check if this is a Windows project folder (starts with drive letter)
  const isWindowsProjectFolder = /^[A-Za-z]--/.test(projectName)

  // Handle paths that are already in correct format (not encoded)
  if (!projectName.startsWith('-') && !isWindowsProjectFolder) {
    pathCache.set(projectName, projectName)
    return projectName
  }

  // Handle Windows project folders by converting them to Unix-like format for processing
  let workingProjectName = projectName
  let drivePrefix = ''

  if (isWindowsProjectFolder) {
    const driveMatch = projectName.match(/^([A-Za-z])--(.+)$/)
    if (driveMatch) {
      const [, driveLetter, pathPart] = driveMatch
      drivePrefix = `${driveLetter.toUpperCase()}:`
      workingProjectName = `-${pathPart}` // Convert to Unix-like format for processing
    }
  }

  // Remove first '-' as it represents root
  let remaining = workingProjectName.substring(1)

  // Handle empty directory names (starting with --)
  while (remaining.startsWith('-')) {
    remaining = remaining.substring(1)
  }

  // Path constructed so far - start with root path using pathImpl
  let currentPath = pathImpl.sep

  while (remaining.length > 0) {
    const candidateBoundaries = [remaining.length]
    let searchIndex = 0
    while (searchIndex < remaining.length) {
      const boundary = remaining.indexOf('-', searchIndex)
      if (boundary === -1) break
      candidateBoundaries.push(boundary)
      searchIndex = boundary + 1
    }

    let foundCandidate = false

    for (let i = 0; i < candidateBoundaries.length; i++) {
      const boundary = candidateBoundaries[i]
      const candidatePart = remaining.substring(0, boundary)
      const candidatePath = pathImpl.join(currentPath, candidatePart)
      const candidatePathWithUnderscore = pathImpl.join(currentPath, candidatePart.replace(/-/g, '_'))
      const candidatePathWithDot = pathImpl.join(currentPath, candidatePart.replace(/-/g, '.'))

      const resolvedCandidatePath = pathImpl.resolve(drivePrefix + candidatePath)
      const resolvedCandidatePathWithUnderscore = pathImpl.resolve(drivePrefix + candidatePathWithUnderscore)
      const resolvedCandidatePathWithDot = pathImpl.resolve(drivePrefix + candidatePathWithDot)

      if (fsExistsSync(resolvedCandidatePath)) {
        currentPath = candidatePath
      } else if (fsExistsSync(resolvedCandidatePathWithUnderscore)) {
        currentPath = candidatePathWithUnderscore
      } else if (fsExistsSync(resolvedCandidatePathWithDot)) {
        currentPath = candidatePathWithDot
      } else {
        continue
      }

      remaining = boundary === remaining.length ? '' : remaining.substring(boundary + 1)
      foundCandidate = true
      break
    }

    if (foundCandidate) continue

    const nextDashIndex = remaining.indexOf('-')
    if (nextDashIndex === -1) {
      currentPath = pathImpl.join(currentPath, remaining)
      break
    }

    // If no exact match exists, fall back to treating the first dash as a path separator.
    currentPath = pathImpl.join(currentPath, remaining.substring(0, nextDashIndex))
    remaining = remaining.substring(nextDashIndex + 1)
  }

  // Use the currentPath as the result since it's already built correctly
  let result = currentPath

  // For Windows paths, add drive prefix
  if (drivePrefix) {
    // Add drive prefix (path already uses correct separator)
    result = drivePrefix + result
  }

  // Save to cache
  pathCache.set(projectName, result)

  return result
}

function fsExistsSync(p) {
  try { return require('fs').existsSync(p) } catch { return false }
}

/**
 * Normalize a file system path to Claude Code project ID format
 * Examples:
 *   D:\git\xemt-core\DFX -> D--git-xemt-core-dfx
 *   /home/user/projects/my-app -> -home-user-projects-my-app
 */
function normalizePathToProjectId(filePath) {
  // Normalize to forward slashes
  const normalized = filePath.replace(/\\/g, '/')

  // Handle Windows paths (C:/... or D:/...)
  const windowsDriveMatch = normalized.match(/^([A-Za-z]):\/(.+)$/)
  if (windowsDriveMatch) {
    const [, drive, pathPart] = windowsDriveMatch
    return `${drive.toUpperCase()}--${pathPart.toLowerCase().replace(/\//g, '-')}`
  }

  // Handle Unix paths (/home/...)
  if (normalized.startsWith('/')) {
    return `-${normalized.substring(1).toLowerCase().replace(/\//g, '-')}`
  }

  // Fallback: just replace slashes with dashes
  return normalized.toLowerCase().replace(/\//g, '-')
}

/**
 * Parse simple YAML (key: value pairs only) — used for workspace.yaml
 */
function parseSimpleYaml(text) {
  const result = {}
  for (const line of text.split('\n')) {
    const match = line.match(/^(\w[\w_]*):\s*(.+)$/)
    if (match) result[match[1]] = match[2].trim()
  }
  return result
}

/**
 * Convert an absolute path to Claude Code project directory name format.
 * Claude Code replaces all non-alphanumeric-non-dash characters (/, _, ., etc.) with dashes.
 * /home/davidw/Projects/gnn -> -home-davidw-Projects-gnn
 * /home/davidw/Tools/ccode_viewer -> -home-davidw-Tools-ccode-viewer
 * /home/davidw/.claude -> -home-davidw--claude
 */
function pathToClaudeDirName(filePath) {
  const normalized = filePath.replace(/\\/g, '/')

  // Handle Windows paths (C:/... or D:/...)
  const winMatch = normalized.match(/^([A-Za-z]):\/(.+)$/)
  if (winMatch) {
    const [, drive, pathPart] = winMatch
    return `${drive.toUpperCase()}--${pathPart.replace(/[^a-zA-Z0-9-]/g, '-')}`
  }

  if (normalized.startsWith('/')) {
    return '-' + normalized.substring(1).replace(/[^a-zA-Z0-9-]/g, '-')
  }

  return normalized.replace(/[^a-zA-Z0-9-]/g, '-')
}

/**
 * Read workspace.yaml from a Copilot session directory
 * Returns { cwd, gitRoot, branch, summary, ... } or null
 */
async function readCopilotWorkspace(sessionDir) {
  try {
    const content = await fs.readFile(path.join(sessionDir, 'workspace.yaml'), 'utf8')
    return parseSimpleYaml(content)
  } catch (e) {
    return null
  }
}

async function extractCopilotProjectPath(sessionFilePath) {
  try {
    const content = await fs.readFile(sessionFilePath, 'utf8')
    const lines = content.trim().split('\n')

    for (const line of lines) {
      try {
        const data = JSON.parse(line)
        const directPath = data?.data?.arguments?.path
        const toolRequests = Array.isArray(data?.data?.toolRequests) ? data.data.toolRequests : []
        const requestPath = toolRequests.find((request) => request?.arguments?.path)?.arguments?.path
        const candidatePath = directPath || requestPath

        if (!candidatePath || typeof candidatePath !== 'string') continue

        const parts = candidatePath.split(/[\\/]/)
        if (/^[A-Za-z]:\\/.test(candidatePath) || /^[A-Za-z]:\//.test(candidatePath)) {
          if (parts.length > 4) return parts.slice(0, 4).join(path.sep)
          return candidatePath
        }

        if (candidatePath.startsWith('/')) {
          if (parts.length > 4) return parts.slice(0, 4).join(path.sep) || path.sep
          return candidatePath
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

async function resolveSessionFilePath(filePath) {
  const stat = await fs.stat(filePath)
  if (!stat.isDirectory()) return filePath
  return path.join(filePath, 'events.jsonl')
}

async function resolveCopilotProjectPath(sessionPath) {
  try {
    const stat = await fs.stat(sessionPath)
    if (stat.isDirectory()) {
      const workspace = await readCopilotWorkspace(sessionPath)
      if (workspace?.cwd) return workspace.cwd

      try {
        const sessionFile = await resolveSessionFilePath(sessionPath)
        return await extractCopilotProjectPath(sessionFile)
      } catch (e) {
        return null
      }
    }

    if (path.extname(sessionPath).toLowerCase() === '.jsonl') {
      return await extractCopilotProjectPath(sessionPath)
    }
  } catch (e) {
    return null
  }

  return null
}

/**
 * Get all projects from Copilot sessions (new directory-based format)
 * Returns a map of projectId -> { sessions: [...], lastUpdated: Date }
 */
async function getCopilotProjects() {
  const projectMap = new Map()

  try {
    const entries = await fs.readdir(COPILOT_SESSION_PATH, { withFileTypes: true })

    for (const entry of entries) {
      const isLegacyFile = entry.isFile() && path.extname(entry.name).toLowerCase() === '.jsonl'
      if (!entry.isDirectory() && !isLegacyFile) continue

      const sessionPath = path.join(COPILOT_SESSION_PATH, entry.name)
      const projectPath = await resolveCopilotProjectPath(sessionPath)
      if (!projectPath) continue

      const projectId = pathToClaudeDirName(projectPath)
      let lastUpdated = null
      try {
        const sessionFile = await resolveSessionFilePath(sessionPath)
        lastUpdated = (await fs.stat(sessionFile)).mtime
      } catch (e) {
        lastUpdated = (await fs.stat(sessionPath)).mtime
      }

      if (!projectMap.has(projectId)) {
        projectMap.set(projectId, {
          projectPath,
          sessions: [],
          lastUpdated
        })
      }

      const project = projectMap.get(projectId)
      project.sessions.push(entry.name)

      if (lastUpdated > project.lastUpdated) {
        project.lastUpdated = lastUpdated
      }
    }
  } catch (e) {
    // Copilot directory doesn't exist or can't be read
  }

  return projectMap
}

async function getProjects() {
  // Use a map to merge projects from multiple sources
  const projectMap = new Map()

  // 1. Get Claude Code projects
  try {
    const entries = await fs.readdir(CLAUDE_PROJECTS_PATH, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const projectPath = path.join(CLAUDE_PROJECTS_PATH, entry.name)
        const sessions = await fs.readdir(projectPath)
        const sessionFiles = sessions.filter(f => f.endsWith('.jsonl'))

        // Determine most-recent session mtime for lastUpdated
        let lastUpdated = null
        for (const f of sessionFiles) {
          try {
            const stats = await fs.stat(path.join(projectPath, f))
            if (!lastUpdated || stats.mtime > lastUpdated) lastUpdated = stats.mtime
          } catch (e) {
            // ignore missing files
          }
        }

        // Use resolved project path as display name
        const displayName = resolveProjectPath(entry.name)

        projectMap.set(entry.name, {
          id: entry.name,
          name: displayName,
          path: projectPath,
          sources: ['claudecode'],
          sessionCount: {
            claudecode: sessionFiles.length
          },
          lastUpdated: lastUpdated ? lastUpdated.toISOString() : undefined
        })
      }
    }
  } catch (e) {
    // Claude projects directory doesn't exist or can't be read
  }

  // 2. Get Copilot projects and merge
  try {
    const copilotProjects = await getCopilotProjects()

    for (const [projectId, copilotData] of copilotProjects) {
      if (projectMap.has(projectId)) {
        // Project exists in both sources - merge
        const existing = projectMap.get(projectId)
        existing.sources.push('gcopilot')
        existing.sessionCount.gcopilot = copilotData.sessions.length
        if (copilotData.projectPath) {
          existing.name = copilotData.projectPath
          existing.path = copilotData.projectPath
        }

        // Update lastUpdated to the most recent
        const existingDate = existing.lastUpdated ? new Date(existing.lastUpdated) : null
        if (!existingDate || copilotData.lastUpdated > existingDate) {
          existing.lastUpdated = copilotData.lastUpdated.toISOString()
        }
      } else {
        // New project only in Copilot
        projectMap.set(projectId, {
          id: projectId,
          name: copilotData.projectPath,
          path: copilotData.projectPath,
          sources: ['gcopilot'],
          sessionCount: {
            gcopilot: copilotData.sessions.length
          },
          lastUpdated: copilotData.lastUpdated.toISOString()
        })
      }
    }
  } catch (e) {
    // Copilot integration failed - continue with Claude projects only
  }

  // 3. Convert map to array and sort by lastUpdated
  const projects = Array.from(projectMap.values())
  projects.sort((a, b) => {
    const dateA = a.lastUpdated ? new Date(a.lastUpdated) : new Date(0)
    const dateB = b.lastUpdated ? new Date(b.lastUpdated) : new Date(0)
    return dateB - dateA
  })

  return projects
}

/**
 * Parse a Copilot session directory and extract session metadata
 */
async function parseCopilotSession(sessionDir) {
  try {
    const eventsPath = await resolveSessionFilePath(sessionDir)
    const stats = await fs.stat(eventsPath)

    let content
    try {
      content = await fs.readFile(eventsPath, 'utf8')
    } catch (e) {
      return null // No events file
    }

    const lines = content.trim().split('\n')
    const sessionStat = await fs.stat(sessionDir)
    const workspace = sessionStat.isDirectory() ? await readCopilotWorkspace(sessionDir) : null

    let startTime, endTime
    let messageCount = 0
    const recentMessages = []
    let sessionId = path.basename(sessionDir)

    for (const line of lines) {
      try {
        const data = JSON.parse(line)

        // Extract sessionId from session.start event
        if (data.type === 'session.start' && data.data?.sessionId) {
          sessionId = data.data.sessionId
        }

        // Track timestamps
        if (data.timestamp) {
          const ts = new Date(data.timestamp)
          if (!startTime || ts < startTime) startTime = ts
          if (!endTime || ts > endTime) endTime = ts
        }

        // Count user and assistant messages
        if (data.type === 'user.message' || data.type === 'assistant.message') {
          messageCount++

          // Extract message text for preview
          let messageText = ''
          if (data.data?.content) {
            if (typeof data.data.content === 'string') {
              messageText = data.data.content
            } else if (Array.isArray(data.data.content)) {
              const textPart = data.data.content.find(p => typeof p === 'string')
              if (textPart) messageText = textPart
            }
          }

          if (messageText) {
            recentMessages.push(messageText.substring(0, 150))
            if (recentMessages.length > 3) recentMessages.shift()
          }
        }
      } catch (e) {
        // Skip invalid JSON lines
      }
    }

    // Use workspace summary as fallback preview
    let preview = recentMessages.join('\n').substring(0, 200)
    if (!preview && workspace?.summary) {
      preview = workspace.summary
    }

    return {
      id: sessionId,
      filePath: sessionDir,
      startTime: startTime ? startTime.toISOString() : undefined,
      endTime: endTime ? endTime.toISOString() : undefined,
      mtime: stats.mtime,
      messageCount,
      totalCost: 0,
      preview,
      isAgent: false,
      source: 'gcopilot',
      branches: workspace?.branch ? [workspace.branch] : []
    }
  } catch (e) {
    return null
  }
}

/**
 * Get Copilot sessions for a specific project
 */
async function getCopilotSessions(projectId) {
  const sessions = []

  try {
    const entries = await fs.readdir(COPILOT_SESSION_PATH, { withFileTypes: true })

    for (const entry of entries) {
      const isLegacyFile = entry.isFile() && path.extname(entry.name).toLowerCase() === '.jsonl'
      if (!entry.isDirectory() && !isLegacyFile) continue

      const sessionPath = path.join(COPILOT_SESSION_PATH, entry.name)
      const projectPath = await resolveCopilotProjectPath(sessionPath)
      if (!projectPath) continue

      const sessionProjectId = pathToClaudeDirName(projectPath)

      // Only include sessions for the requested project
      if (sessionProjectId === projectId) {
        const session = await parseCopilotSession(sessionPath)
        if (session && session.messageCount >= 3) {
          sessions.push(session)
        }
      }
    }
  } catch (e) {
    // Copilot directory doesn't exist or can't be read
  }

  return sessions
}

async function getSessions(projectName) {
  const sessions = []

  // 1. Get Claude Code sessions
  try {
    const projectPath = path.isAbsolute(projectName)
      ? projectName
      : path.join(CLAUDE_PROJECTS_PATH, projectName.replace(/\//g, '-'))

    const files = await fs.readdir(projectPath)

    for (const file of files) {
      if (file.endsWith('.jsonl')) {
        const filePath = path.join(projectPath, file)
        const stats = await fs.stat(filePath)
        const content = await fs.readFile(filePath, 'utf8')
        const lines = content.trim().split('\n')

        let startTime, endTime
        let messageCount = 0
        let totalCost = 0
        const recentMessages = []
        const branches = new Set()

        for (const line of lines) {
          try {
            const data = JSON.parse(line)
            if (data.timestamp) {
              const ts = new Date(data.timestamp)
              if (!startTime || ts < startTime) startTime = ts
              if (!endTime || ts > endTime) endTime = ts
            }
            if (data.gitBranch) branches.add(data.gitBranch)
            if (data.type === 'user' || data.type === 'assistant') {
              messageCount++
              let messageText = ''
              if (data.message && data.message.content) {
                if (data.type === 'user' && !data.isMeta) {
                  messageText = getUserPreviewText(data.message.content)
                } else if (typeof data.message.content === 'string') messageText = data.message.content
                else if (Array.isArray(data.message.content)) {
                  const t = data.message.content.find(i => i.type === 'text')
                  if (t && t.text) messageText = t.text
                }
              } else if (data.content) {
                messageText = data.type === 'user' && !data.isMeta
                  ? getUserPreviewText(data.content)
                  : (typeof data.content === 'string' ? data.content : '')
              }
              if (messageText) {
                recentMessages.push(messageText.substring(0, 150))
                if (recentMessages.length > 3) recentMessages.shift()
              }
            }
            if (data.costUSD) totalCost += data.costUSD
          } catch (e) {
            // skip
          }
        }

        let sessionId = path.basename(file, '.jsonl')
        if (lines.length > 0) {
          try {
            const first = JSON.parse(lines[0])
            if (first.sessionId) sessionId = first.sessionId
          } catch (e) {}
        }

        // Detect if this is an agent/subagent session
        const isAgent = file.startsWith('agent-')

        // Only include sessions with 3+ messages
        if (messageCount >= 3) {
          sessions.push({
            id: sessionId,
            projectPath,
            filePath,
            startTime: startTime ? startTime.toISOString() : undefined,
            endTime: endTime ? endTime.toISOString() : undefined,
            mtime: stats.mtime,
            messageCount,
            totalCost,
            preview: recentMessages.join('\n').substring(0, 200),
            isAgent,
            source: 'claudecode',
            branches: [...branches]
          })
        }
      }
    }
  } catch (e) {
    // Claude project directory doesn't exist or can't be read
  }

  // 2. Get Copilot sessions for this project
  try {
    const copilotSessions = await getCopilotSessions(projectName)
    sessions.push(...copilotSessions)
  } catch (e) {
    // Copilot integration failed - continue with Claude sessions only
  }

  // 3. Sort all sessions by modification time (newest first)
  sessions.sort((a, b) => {
    if (!a.mtime || !b.mtime) return 0
    return b.mtime.getTime() - a.mtime.getTime()
  })

  return sessions
}

async function readSessionFile(filePath) {
  try {
    const targetFile = await resolveSessionFilePath(filePath)
    const content = await fs.readFile(targetFile, 'utf8')
    const lines = content.trim().split('\n')
    const messages = []
    for (const line of lines) {
      try { messages.push(JSON.parse(line)) } catch (e) {}
    }
    return messages
  } catch (e) {
    return []
  }
}

module.exports = {
  getProjects,
  getSessions,
  readSessionFile,
  deleteSession,
  resolveSessionFilePath,
  extractCopilotProjectPath,
  resolveCopilotProjectPath
}

function mapCopilotToolName(name) {
  const map = {
    'bash': 'Bash', 'read_bash': 'Bash', 'write_bash': 'Bash', 'stop_bash': 'Bash',
    'powershell': 'Powershell', 'read_powershell': 'Powershell', 'write_powershell': 'Powershell', 'stop_powershell': 'Powershell', 'list_powershell': 'Powershell',
    'view': 'Read', 'create': 'Write',
    'edit': 'Edit', 'grep': 'Grep', 'rg': 'Grep', 'glob': 'Glob',
    'report_intent': 'ReportIntent', 'apply_patch': 'ApplyPatch',
    'sql': 'Sql', 'ask_user': 'AskUser', 'task': 'Task',
    'web_search': 'WebSearch', 'read_agent': 'ReadAgent',
    'skill': 'Skill', 'store_memory': 'StoreMemory'
  }
  return map[name] || name
}

function mapCopilotToolInput(toolName, args) {
  if (!args) return {}
  if (typeof args === 'string') {
    if (toolName === 'apply_patch') return { patch: args }
    return { raw: args }
  }
  switch (toolName) {
    case 'bash': case 'read_bash': case 'write_bash': case 'stop_bash':
      return { command: args.command || '', description: args.description || '' }
    case 'powershell':
      return { command: args.command || '', description: args.description || '' }
    case 'read_powershell':
      return { command: 'read shell ' + (args.shellId || ''), description: 'Read PowerShell output' }
    case 'write_powershell':
      return { command: 'input: ' + (args.input || ''), description: 'Write to PowerShell shell ' + (args.shellId || '') }
    case 'stop_powershell':
      return { command: 'stop shell ' + (args.shellId || ''), description: '' }
    case 'list_powershell':
      return { command: 'list shells', description: '' }
    case 'view':
      return { file_path: args.path || '' }
    case 'create':
      return { file_path: args.path || '', content: args.file_text || '' }
    case 'edit':
      return { file_path: args.path || '', old_str: args.old_str || '', new_str: args.new_str || '' }
    case 'grep': case 'rg':
      return { pattern: args.pattern || '', path: args.path || '', glob: args.glob || '', output_mode: args.output_mode || '' }
    case 'glob':
      return { pattern: args.pattern || '', path: args.path || '' }
    case 'report_intent':
      return { intent: args.intent || '' }
    case 'sql':
      return { query: args.query || '', description: args.description || '' }
    case 'ask_user':
      return { question: args.question || '' }
    case 'task':
      return { prompt: args.prompt || '', name: args.name || '', agent_type: args.agent_type || '', description: args.description || '' }
    case 'web_search':
      return { query: args.query || '' }
    case 'read_agent':
      return { agent_id: args.agent_id || '' }
    default:
      return args
  }
}

function normalizeCopilotEvents(msgs) {
  // Pass 1: Index tool starts and completes by toolCallId
  const toolStarts = {}
  const toolCompletes = {}
  for (const m of msgs) {
    if (m.type === 'tool.execution_start' && m.data) {
      toolStarts[m.data.toolCallId] = { toolName: m.data.toolName, arguments: m.data.arguments }
    }
    if (m.type === 'tool.execution_complete' && m.data) {
      toolCompletes[m.data.toolCallId] = { result: m.data.result, success: m.data.success }
    }
  }

  // Pass 2: Group into interactions (per user.message), sub-group by turnId
  const interactions = []
  let current = null
  for (const m of msgs) {
    if (m.type === 'user.message') {
      current = { user: m, turns: [] }
      interactions.push(current)
    } else if (!current) {
      continue
    } else if (m.type === 'assistant.turn_start') {
      current.turns.push({ events: [] })
    } else if (m.type === 'assistant.message' && current.turns.length > 0) {
      current.turns[current.turns.length - 1].events.push(m)
    }
    // tool.execution_start/complete, turn_end, etc. handled via indexed maps
  }

  // Fallback: if no turn structure, group all assistant.message events after each user.message
  if (interactions.length > 0 && interactions.every(i => i.turns.length === 0)) {
    for (const interaction of interactions) {
      interaction.turns.push({ events: [] })
    }
    let target = null
    for (const m of msgs) {
      if (m.type === 'user.message') {
        target = interactions.find(i => i.user === m)
      } else if (target && m.type === 'assistant.message') {
        target.turns[0].events.push(m)
      }
    }
  }

  // Pass 3: Build normalized output
  const users = []
  const mapping = {}

  for (const interaction of interactions) {
    const userId = interaction.user.id || `u_${users.length}`
    const userContent = interaction.user.data?.content || ''
    users.push({
      id: userId,
      content: userContent,
      preview: typeof userContent === 'string' ? userContent : '',
      timestamp: interaction.user.timestamp,
      rawType: 'user.message'
    })

    const contentBlocks = []
    for (const turn of interaction.turns) {
      for (const msg of turn.events) {
        const data = msg.data || {}

        // Thinking block
        if (data.reasoningText && typeof data.reasoningText === 'string' && data.reasoningText.trim()) {
          // Skip encrypted/encoded blobs
          if (!/^[A-Za-z0-9+/=]+$/.test(data.reasoningText) || data.reasoningText.length < 40) {
            contentBlocks.push({ type: 'thinking', thinking: data.reasoningText })
          }
        }

        // Text content
        if (data.content && typeof data.content === 'string' && data.content.trim()) {
          contentBlocks.push({ type: 'text', text: data.content })
        }

        // Tool requests - merge with indexed start/complete data
        if (Array.isArray(data.toolRequests)) {
          for (const tr of data.toolRequests) {
            const callId = tr.toolCallId
            const start = toolStarts[callId]
            const complete = toolCompletes[callId]
            const originalName = start?.toolName || tr.name
            const mappedName = mapCopilotToolName(originalName)
            const args = start?.arguments || tr.arguments

            contentBlocks.push({
              type: 'tool_use',
              id: callId,
              name: mappedName,
              input: mapCopilotToolInput(originalName, args),
              _copilotToolName: originalName
            })

            if (complete) {
              const resultContent = complete.result?.detailedContent || complete.result?.content || ''
              contentBlocks.push({
                type: 'tool_result',
                tool_use_id: callId,
                content: resultContent,
                _copilotSuccess: complete.success
              })
            }
          }
        }
      }
    }

    if (contentBlocks.length > 0) {
      mapping[userId] = [{
        id: `turn_${userId}`,
        content: contentBlocks,
        timestamp: interaction.turns[0]?.events[0]?.timestamp || interaction.user.timestamp,
        raw: null
      }]
    } else {
      mapping[userId] = []
    }
  }

  return { users, mapping }
}

async function mapSessionMessages(filePath) {
  const msgs = await readSessionFile(filePath)

  // Detect and route Copilot sessions
  const isCopilot = (filePath.includes('.copilot') || filePath.includes('session-state'))
    && msgs.length > 0 && msgs[0].type === 'session.start'
  if (isCopilot) return normalizeCopilotEvents(msgs)

  const users = []
  const assistants = []

  // Normalize messages with canonical id, type, timestamp, and content
  const norm = msgs.map((m, i) => {
  const id = m.uuid || (m.message && m.message.id) || m.id || `i_${i}`
  const rawType = m.type
  let type = rawType
  const isMetaUser = rawType === 'user' && m.isMeta

    // Normalize Copilot event types: user.message -> user, assistant.message -> assistant
    if (type === 'user.message') type = 'user'
    if (type === 'assistant.message' || type === 'assistant.turn_start' || type === 'assistant.turn_end') type = 'assistant'
    if (type === 'tool.execution_start' || type === 'tool.execution_complete') type = 'assistant'
    if (type === 'system.message' || type === 'session.start' || type === 'session.model_change' || type === 'session.info' || type === 'session.plan_changed') type = 'system'

    // Normalize tool messages to assistant (tool_use, tool_result, etc.)
    if (type === 'tool_use' || type === 'tool_result' || type === 'tool') type = 'assistant'

    // Claude slash-command expansions and other meta user payloads should render on the assistant side.
    if (isMetaUser) type = 'assistant'

    // If not set, prefer message.role (e.g., { message: { role: 'assistant' } })
    if (!type && m.message && m.message.role) type = m.message.role

    // If nested message.type indicates a tool use/result, treat as assistant
    if (!type && m.message && (m.message.type === 'tool_use' || m.message.type === 'tool_result' || m.message.type === 'tool')) {
      type = 'assistant'
    }

    // If message content is an array and contains tool_result/tool entries, force as assistant
    const contentCandidate = (m.message && m.message.content) || m.content
    if (Array.isArray(contentCandidate)) {
      for (const item of contentCandidate) {
        if (item && (item.type === 'tool_result' || item.type === 'tool_use' || item.type === 'tool')) {
          type = 'assistant'
          break
        }
      }
    }

  if (!type && m.userType === 'external') type = 'user'
  // If raw type indicates a tool (e.g., 'tool_result'), force assistant classification
  if (typeof rawType === 'string' && rawType.startsWith('tool')) type = 'assistant'
    const timestamp = m.timestamp || (m.message && m.message.timestamp) || null
    const content = (m.message && (m.message.content || m.message)) || m.data?.content || m.content || m
  return { raw: m, rawType, id, type, timestamp, content, index: i, parentUuid: m.parentUuid || m.parentId }
  })

  // Build users array and assistant array
  for (const m of norm) {
    if (m.type === 'user') users.push(m)
    else if (m.type === 'assistant') assistants.push(m)
    // Skip 'system' and other non-conversation types
  }

  // If timestamps present, convert to Date for comparisons
  const toDate = t => { try { return t ? new Date(t) : null } catch { return null } }
  norm.forEach(n => { n.ts = toDate(n.timestamp) })

  // Build mapping from user.id to assistant messages
  const mapping = {}
  // initialize mapping for each user
  users.forEach(u => { mapping[u.id] = [] })

  // Helper: find user by uuid/id
  const userById = id => users.find(u => u.raw.uuid === id || u.id === id)

  // Assign assistants
  for (const a of assistants) {
    // If this assistant message is a tool_result that references another assistant (parentUuid),
    // try to merge its content into the referenced assistant instead of treating it as separate.
    if (a.raw && a.raw.type === 'tool_result' && a.parentUuid) {
      const parentAssistant = assistants.find(x => x.id === a.parentUuid || x.raw.uuid === a.parentUuid)
      if (parentAssistant) {
        // Merge content: append to parentAssistant.content (array or string)
        if (Array.isArray(parentAssistant.content)) parentAssistant.content.push(a.content)
        else parentAssistant.content = [parentAssistant.content, a.content]
        continue // skip assigning this message separately
      }
    }
    let assigned = null
    // 1) explicit parentUuid
    if (a.parentUuid) assigned = userById(a.parentUuid)
    // 2) explicit parent in raw fields
    if (!assigned && a.raw && a.raw.parentUuid) assigned = userById(a.raw.parentUuid)
    // 3) find closest preceding user by timestamp or index
    if (!assigned) {
      // prefer timestamp if available
      if (a.ts) {
        // find user with max ts < a.ts
        let candidate = null
        for (const u of users) {
          if (u.ts && u.ts <= a.ts) {
            if (!candidate || u.ts > candidate.ts) candidate = u
          }
        }
        assigned = candidate
      }
      // fallback to previous user by index
      if (!assigned) {
        // find user with highest index less than assistant index
        let candidate = null
        for (const u of users) {
          if (u.index <= a.index) {
            if (!candidate || u.index > candidate.index) candidate = u
          }
        }
        assigned = candidate
      }
    }

    if (assigned) mapping[assigned.id].push(a)
    else {
      // no users at all: group under a special key
      const key = '__no_user__'
      mapping[key] = mapping[key] || []
      mapping[key].push(a)
    }
  }

  // Helper: check if content contains image (to avoid expensive stringify)
  const containsImage = (content) => {
    if (!content) return false
    if (Array.isArray(content)) {
      return content.some(item => item && item.type === 'image')
    }
    if (typeof content === 'object' && content.type === 'image') {
      return true
    }
    return false
  }

  // Prepare simplified user list (id, preview, timestamp)
  const usersOut = users.map(u => {
    const preview = getUserPreviewText(u.content)
    return { 
      id: u.id, 
      content: u.content, // Preserve original structure for rendering
      preview: preview, // Keep full text for search data source
      timestamp: u.timestamp, 
      rawType: u.rawType || null 
    }
  })

  // Convert assistant messages to serializable form
  const mapOut = {}
  for (const [k, arr] of Object.entries(mapping)) {
    mapOut[k] = arr.map(a => ({ id: a.id, content: a.content, timestamp: a.timestamp, raw: a.raw }))
  }

  return { users: usersOut, mapping: mapOut }
}

async function searchInProject(projectId, keyword) {
  try {
    // Get all sessions for the project (limit to first 100)
    const sessions = await getSessions(projectId)
    const limitedSessions = sessions.slice(0, 100)

    const results = []
    const keywordLower = keyword.toLowerCase()

    // Search through each session
    for (const session of limitedSessions) {
      try {
        const { users, mapping } = await mapSessionMessages(session.filePath)

        // Helper: check if content contains image
        const containsImage = (content) => {
          if (!content) return false
          if (typeof content === 'string') {
            // Check if it's stringified JSON containing image
            if (content.includes('"type":"image"')) return true
          }
          if (Array.isArray(content)) {
            return content.some(item => item && item.type === 'image')
          }
          if (typeof content === 'object' && content.type === 'image') {
            return true
          }
          return false
        }

        // Search through user messages
        for (const user of users) {
          // Skip messages containing images
          if (containsImage(user.content)) continue

          const preview = user.preview || ''
          if (!preview) continue
          if (preview.toLowerCase().includes(keywordLower)) {
            // Get assistant replies for this user message
            const assistantReplies = mapping[user.id] || []

            results.push({
              sessionId: session.id,
              sessionFile: session.filePath,
              sessionStart: session.startTime,
              userMessage: {
                id: user.id,
                preview: preview.substring(0, 300), // Limit preview length
                timestamp: user.timestamp
              },
              assistantReplies: assistantReplies.map(a => ({
                id: a.id,
                preview: typeof a.content === 'string'
                  ? a.content.substring(0, 200)
                  : JSON.stringify(a.content).substring(0, 200),
                timestamp: a.timestamp
              })),
              timestamp: user.timestamp || session.startTime
            })

            // Limit total results to 200
            if (results.length >= 200) break
          }
        }

        if (results.length >= 200) break
      } catch (err) {
        console.error(`Error searching session ${session.id}:`, err)
        // Continue with next session
      }
    }

    // Sort by timestamp, newest first
    results.sort((a, b) => {
      const aTime = new Date(a.timestamp || 0)
      const bTime = new Date(b.timestamp || 0)
      return bTime - aTime
    })

    return results
  } catch (err) {
    console.error('searchInProject error:', err)
    throw err
  }
}

module.exports.mapSessionMessages = mapSessionMessages

async function deleteSession(filePath) {
  try {
    const stat = await fs.stat(filePath)
    if (stat.isDirectory()) {
      await fs.rm(filePath, { recursive: true })
    } else {
      await fs.unlink(filePath)
    }
  } catch (err) {
    throw new Error('Failed to delete session file: ' + err.message)
  }
}
module.exports.searchInProject = searchInProject
