const fs = require('fs')
const { watch } = require('chokidar')

// Map filePath -> { watcher, subscribers: Set(res), offset }
const watchers = new Map()

function ensureWatcher(filePath) {
  let info = watchers.get(filePath)
  if (info) return info

  const watcher = watch(filePath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
  })

  info = { watcher, subscribers: new Set(), offset: 0 }

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
              try { s.write(`event: session_appended\n`) } catch(e){}
              try { s.write(`data: ${JSON.stringify({ file: filePath, line })}\n\n`) } catch(e){}
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

module.exports = { subscribe, unsubscribe }
