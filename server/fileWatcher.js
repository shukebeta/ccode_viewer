const fs = require('fs')
const { watch } = require('chokidar')
const fsHelpers = require('./fsHelpers')

// Map filePath -> { watcher, subscribers: Set(res), offset }
const watchers = new Map()

function inferSessionFormat(parsed) {
  if (!parsed || typeof parsed !== 'object') return null
  if (parsed.type === 'session_meta') return 'codex'
  return null
}

function detectSessionFormat(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r')
    const buffer = Buffer.alloc(8192)
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0)
    fs.closeSync(fd)

    if (bytesRead <= 0) return 'generic'

    const lines = buffer.toString('utf8', 0, bytesRead).split(/\r?\n/).filter(Boolean)
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line)
        const format = inferSessionFormat(parsed)
        if (format) return format
      } catch (e) {
        // Ignore malformed lines while sniffing the session format.
      }
    }
  } catch (e) {
    return 'generic'
  }

  return 'generic'
}

function normalizeAppendedLine(parsed, rawLine, sessionFormat) {
  if (sessionFormat === 'codex') {
    const normalized = fsHelpers.normalizeCodexEvent(parsed)
    return normalized ? JSON.stringify(normalized) : null
  }

  if (fsHelpers.shouldHideRawSessionEvent(parsed)) return null

  return rawLine
}

function ensureWatcher(filePath) {
  let info = watchers.get(filePath)
  if (info) return info

  const watcher = watch(filePath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
  })

  info = { watcher, subscribers: new Set(), offset: 0, sessionFormat: detectSessionFormat(filePath) }

  // Initialize offset to file size if file exists
  try {
    const stats = fs.statSync(filePath)
    info.offset = stats.size
  } catch (e) {
    info.offset = 0
  }

  watcher.on('change', () => {
    // On change, read appended bytes from last offset
    try {
      const stats = fs.statSync(filePath)
      const newSize = stats.size
      if (newSize > info.offset) {
        const stream = fs.createReadStream(filePath, { start: info.offset, end: newSize - 1, encoding: 'utf8' })
        let data = ''
        stream.on('data', chunk => data += chunk)
        stream.on('end', () => {
          info.offset = newSize
          // Split into lines and emit to subscribers
          const lines = data.split(/\r?\n/).filter(Boolean)
          for (const s of info.subscribers) {
            for (const line of lines) {
              let parsed
              try { parsed = JSON.parse(line) } catch { continue }
              const inferredFormat = inferSessionFormat(parsed)
              if (inferredFormat && info.sessionFormat !== inferredFormat) info.sessionFormat = inferredFormat

              const normalizedLine = normalizeAppendedLine(parsed, line, info.sessionFormat)
              if (!normalizedLine) continue

              try { s.write(`event: session_appended\n`) } catch(e){}
              try { s.write(`data: ${JSON.stringify({ file: filePath, line: normalizedLine })}\n\n`) } catch(e){}
            }
          }
        })
        stream.on('error', (err) => {
          console.error('Read stream error', err)
        })
      }
    } catch (err) {
      console.error('Error reading appended data', err)
    }
  })

  watcher.on('error', (err) => {
    console.error('Watcher error', err)
  })

  watchers.set(filePath, info)
  return info
}

function subscribe(filePath, res) {
  const info = ensureWatcher(filePath)
  info.subscribers.add(res)
  // When client closes, unsubscribe
  const onClose = () => {
    unsubscribe(filePath, res)
  }
  res.on('close', onClose)
}

function unsubscribe(filePath, res) {
  const info = watchers.get(filePath)
  if (!info) return
  info.subscribers.delete(res)
  // If no subscribers left, close watcher
  if (info.subscribers.size === 0) {
    try { info.watcher.close() } catch (e) {}
    watchers.delete(filePath)
  }
}

module.exports = {
  subscribe,
  unsubscribe,
  _private: {
    detectSessionFormat,
    inferSessionFormat,
    normalizeAppendedLine
  }
}
