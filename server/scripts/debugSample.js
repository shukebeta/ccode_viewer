const path = require('path')
const fs = require('fs')
const { mapSessionMessages } = require('../fsHelpers')

const SAMPLE_PATH = path.join(__dirname, '..', 'testdata', 'sample.jsonl')

async function main() {
  if (!fs.existsSync(SAMPLE_PATH)) {
    console.error('sample.jsonl not found')
    process.exit(1)
  }
  const content = fs.readFileSync(SAMPLE_PATH, 'utf8')
  const lines = content.trim().split('\n').slice(0, 200)
  const tmp = require('os').tmpdir()
  const tempFile = path.join(tmp, 'claude-sample-trim.jsonl')
  fs.writeFileSync(tempFile, lines.join('\n'))
  const out = await mapSessionMessages(tempFile)
  console.log('users count:', out.users.length)
  out.users.forEach((u, i) => {
    console.log(i, 'id=', u.id, 'preview=', u.preview.substring(0,80))
  })
  console.log('mapping keys:', Object.keys(out.mapping).slice(0,20))
}

main().catch(e => { console.error(e); process.exit(2) })
