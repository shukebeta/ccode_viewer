const fs = require('fs').promises
const path = require('path')
const os = require('os')

const CLAUDE_PROJECTS_PATH = path.join(os.homedir(), '.claude', 'projects')

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
    // Find next '-' position
    let nextDashIndex = remaining.indexOf('-')

    if (nextDashIndex === -1) {
      // If no more '-', treat the rest as one part
      currentPath = pathImpl.join(currentPath, remaining)
      break
    }

    // Check path when '-' is replaced with path separator
    const possiblePart = remaining.substring(0, nextDashIndex)
    const possiblePathAsSlash = pathImpl.join(currentPath, possiblePart)

    // Also check path when '-' is replaced with '_'
    const possiblePathAsUnderscore = pathImpl.join(currentPath, possiblePart.replace(/-/g, '_'))

    // Also check path when '-' is replaced with '.'
    const possiblePathAsDot = pathImpl.join(currentPath, possiblePart.replace(/-/g, '.'))

    // Resolve paths to handle Windows drive letters and normalize
    const resolvedPathAsSlash = pathImpl.resolve(drivePrefix + possiblePathAsSlash)
    const resolvedPathAsUnderscore = pathImpl.resolve(drivePrefix + possiblePathAsUnderscore)
    const resolvedPathAsDot = pathImpl.resolve(drivePrefix + possiblePathAsDot)

    if (fsExistsSync(resolvedPathAsSlash)) {
      // If directory exists, separate with path separator
      currentPath = possiblePathAsSlash
      remaining = remaining.substring(nextDashIndex + 1)
    } else if (fsExistsSync(resolvedPathAsUnderscore)) {
      // If exists when replaced with '_', process with '_'
      currentPath = possiblePathAsUnderscore
      remaining = remaining.substring(nextDashIndex + 1)
    } else if (fsExistsSync(resolvedPathAsDot)) {
      // If exists when replaced with '.', process with '.'
      currentPath = possiblePathAsDot
      remaining = remaining.substring(nextDashIndex + 1)
    } else {
      // If directory doesn't exist, try combining multiple segments
      let foundValid = false
      let searchIndex = nextDashIndex + 1

      while (searchIndex < remaining.length) {
        const nextSearchIndex = remaining.indexOf('-', searchIndex)
        if (nextSearchIndex === -1) {
          // Search to the end
          const testPart = remaining
          const testPath = pathImpl.join(currentPath, testPart)
          const testPartWithUnderscore = testPart.replace(/-/g, '_')
          const testPathWithUnderscore = pathImpl.join(currentPath, testPartWithUnderscore)
          const testPartWithDot = testPart.replace(/-/g, '.')
          const testPathWithDot = pathImpl.join(currentPath, testPartWithDot)

          // Resolve paths for Windows compatibility
          // Resolve paths for Windows compatibility
          const resolvedTestPath = pathImpl.resolve(drivePrefix + testPath)
          const resolvedTestPathWithUnderscore = pathImpl.resolve(drivePrefix + testPathWithUnderscore)
          const resolvedTestPathWithDot = pathImpl.resolve(drivePrefix + testPathWithDot)

          if (fsExistsSync(resolvedTestPath)) {
            currentPath = testPath
            remaining = ''
            foundValid = true
          } else if (fsExistsSync(resolvedTestPathWithUnderscore)) {
            currentPath = testPathWithUnderscore
            remaining = ''
            foundValid = true
          } else if (fsExistsSync(resolvedTestPathWithDot)) {
            currentPath = testPathWithDot
            remaining = ''
            foundValid = true
          }
          break
        }

        // Test including up to next '-'
        const testPart = remaining.substring(0, nextSearchIndex)
        const testPath = pathImpl.join(currentPath, testPart)

        // Also test path with '_'
        const testPartWithUnderscore = testPart.replace(/-/g, '_')
        const testPathWithUnderscore = pathImpl.join(currentPath, testPartWithUnderscore)

        // Also test path with '.'
        const testPartWithDot = testPart.replace(/-/g, '.')
        const testPathWithDot = pathImpl.join(currentPath, testPartWithDot)

        // Resolve paths for Windows compatibility
        // Resolve paths for Windows compatibility
        const resolvedTestPath = pathImpl.resolve(drivePrefix + testPath)
        const resolvedTestPathWithUnderscore = pathImpl.resolve(drivePrefix + testPathWithUnderscore)
        const resolvedTestPathWithDot = pathImpl.resolve(drivePrefix + testPathWithDot)

        if (fsExistsSync(resolvedTestPath)) {
          currentPath = testPath
          remaining = remaining.substring(nextSearchIndex + 1)
          foundValid = true
          break
        } else if (fsExistsSync(resolvedTestPathWithUnderscore)) {
          currentPath = testPathWithUnderscore
          remaining = remaining.substring(nextSearchIndex + 1)
          foundValid = true
          break
        } else if (fsExistsSync(resolvedTestPathWithDot)) {
          currentPath = testPathWithDot
          remaining = remaining.substring(nextSearchIndex + 1)
          foundValid = true
          break
        }

        searchIndex = nextSearchIndex + 1
      }

      if (!foundValid) {
        // If directory doesn't exist, fall back to treating first part as directory
        currentPath = pathImpl.join(currentPath, possiblePart)
        remaining = remaining.substring(nextDashIndex + 1)
      }
    }
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

async function getProjects() {
  try {
    const entries = await fs.readdir(CLAUDE_PROJECTS_PATH, { withFileTypes: true })
    const projects = []
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

        // Use resolved project path as display name (matches electron resolver)
        const displayName = resolveProjectPath(entry.name)
        projects.push({
          id: entry.name,
          name: displayName,
          path: projectPath,
          sessionCount: sessionFiles.length,
          lastUpdated: lastUpdated ? lastUpdated.toISOString() : undefined
        })
      }
    }
    return projects
  } catch (e) {
    return []
  }
}

async function getSessions(projectName) {
  try {
    const projectPath = path.isAbsolute(projectName)
      ? projectName
      : path.join(CLAUDE_PROJECTS_PATH, projectName.replace(/\//g, '-'))

    const files = await fs.readdir(projectPath)
    const sessions = []

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

        for (const line of lines) {
          try {
            const data = JSON.parse(line)
            if (data.timestamp) {
              const ts = new Date(data.timestamp)
              if (!startTime || ts < startTime) startTime = ts
              if (!endTime || ts > endTime) endTime = ts
            }
            if (data.type === 'user' || data.type === 'assistant') {
              messageCount++
              let messageText = ''
              if (data.message && data.message.content) {
                if (typeof data.message.content === 'string') messageText = data.message.content
                else if (Array.isArray(data.message.content)) {
                  const t = data.message.content.find(i => i.type === 'text')
                  if (t && t.text) messageText = t.text
                }
              } else if (data.content) {
                messageText = typeof data.content === 'string' ? data.content : ''
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

        sessions.push({
          id: sessionId,
          projectPath,
          filePath,
          startTime: startTime ? startTime.toISOString() : undefined,
          endTime: endTime ? endTime.toISOString() : undefined,
          mtime: stats.mtime,
          messageCount,
          totalCost,
          preview: recentMessages.join('\n').substring(0, 200)
        })
      }
    }

    sessions.sort((a, b) => {
      if (!a.mtime || !b.mtime) return 0
      return b.mtime.getTime() - a.mtime.getTime()
    })

    return sessions
  } catch (e) {
    return []
  }
}

async function readSessionFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8')
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

module.exports = { getProjects, getSessions, readSessionFile }

async function mapSessionMessages(filePath) {
  const msgs = await readSessionFile(filePath)
  const users = []
  const assistants = []

  // Normalize messages with canonical id, type, timestamp, and content
  const norm = msgs.map((m, i) => {
  const id = m.uuid || (m.message && m.message.id) || `i_${i}`
  const rawType = m.type
  let type = rawType

    // Normalize tool messages to assistant (tool_use, tool_result, etc.)
    if (type === 'tool_use' || type === 'tool_result' || type === 'tool') type = 'assistant'

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
    const content = (m.message && (m.message.content || m.message)) || m.content || m
  return { raw: m, rawType, id, type, timestamp, content, index: i, parentUuid: m.parentUuid }
  })

  // Build users array and assistant array
  for (const m of norm) {
    if (m.type === 'user') users.push(m)
    else if (m.type === 'assistant') assistants.push(m)
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

  // Prepare simplified user list (id, preview, timestamp)
  const usersOut = users.map(u => ({ id: u.id, preview: (typeof u.content === 'string' ? u.content : JSON.stringify(u.content)).substring(0,200), timestamp: u.timestamp, rawType: u.rawType || null }))

  // Convert assistant messages to serializable form
  const mapOut = {}
  for (const [k, arr] of Object.entries(mapping)) {
    mapOut[k] = arr.map(a => ({ id: a.id, content: a.content, timestamp: a.timestamp, raw: a.raw }))
  }

  return { users: usersOut, mapping: mapOut }
}

module.exports.mapSessionMessages = mapSessionMessages
