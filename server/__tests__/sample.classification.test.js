const fs = require('fs')
const path = require('path')
const os = require('os')
const { mapSessionMessages } = require('../fsHelpers')

const SAMPLE_PATH = path.join(__dirname, '..', 'testdata', 'sample.jsonl')

describe('sample.jsonl classification', () => {
  it('does not classify tool_* messages as users in the first 200 lines', async () => {
    if (!fs.existsSync(SAMPLE_PATH)) {
      console.warn('sample.jsonl not found; skipping sample-based test')
      return
    }
    const content = fs.readFileSync(SAMPLE_PATH, 'utf8')
    const lines = content.trim().split('\n').slice(0, 200)
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-sample-'))
    const file = path.join(tempDir, 'sample.jsonl')
    fs.writeFileSync(file, lines.join('\n'))

    const out = await mapSessionMessages(file)
    // For each user id in out.users, find the original raw message in the mapping keys
    for (const u of out.users) {
      // Ensure the rawType isn't a tool_ variant
      expect(u.rawType).not.toMatch(/^tool/i)
    }
  })
})
