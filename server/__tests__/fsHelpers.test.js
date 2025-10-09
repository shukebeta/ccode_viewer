const { mapSessionMessages } = require('../fsHelpers')

// We'll create helper to write a temporary jsonl file for test purposes
const fs = require('fs')
const os = require('os')
const path = require('path')

function writeTempJsonl(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-test-'))
  const file = path.join(dir, 'session.jsonl')
  fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n'))
  return file
}

describe('mapSessionMessages', () => {
  it('classifies tool_use and tool_result as assistant', async () => {
    const lines = [
      { type: 'user', uuid: 'u1', timestamp: '2025-09-20T00:00:00.000Z', message: { content: 'hello' } },
      { type: 'tool_use', uuid: 't1', timestamp: '2025-09-20T00:00:01.000Z', message: { type: 'tool_use', name: 'Foo' } },
      { type: 'tool_result', uuid: 'tr1', timestamp: '2025-09-20T00:00:02.000Z', parentUuid: 't1', content: 'result' }
    ]
    const file = writeTempJsonl(lines)
    const out = await mapSessionMessages(file)
    // one user
    expect(out.users.length).toBe(1)
    const userId = out.users[0].id
    // mapping exists and contains assistant entries
    expect(out.mapping[userId]).toBeDefined()
    // tool_use and tool_result should be considered assistant messages
    expect(out.mapping[userId].length).toBeGreaterThanOrEqual(1)
  })

  it('merges tool_result content into parent assistant when parentUuid references assistant', async () => {
    const lines = [
      { type: 'user', uuid: 'u1', timestamp: '2025-09-20T00:00:00.000Z', message: { content: 'run this' } },
      { type: 'assistant', uuid: 'a1', timestamp: '2025-09-20T00:00:01.000Z', message: { content: 'I will run' } },
      { type: 'tool_result', uuid: 'tr1', timestamp: '2025-09-20T00:00:02.000Z', parentUuid: 'a1', content: 'tool output' }
    ]
    const file = writeTempJsonl(lines)
    const out = await mapSessionMessages(file)
    const userId = out.users[0].id
    expect(out.mapping[userId].length).toBe(1)
    const a = out.mapping[userId][0]
    // merged content should contain the tool output
    const asText = typeof a.content === 'string' ? a.content : JSON.stringify(a.content)
    expect(asText).toContain('tool output')
  })

  it('assigns assistant to nearest preceding user by timestamp when lacking parentUuid', async () => {
    const lines = [
      { type: 'user', uuid: 'u1', timestamp: '2025-09-20T00:00:00.000Z', message: { content: 'first' } },
      { type: 'assistant', uuid: 'a1', timestamp: '2025-09-20T00:00:01.000Z', message: { content: 'reply to first' } },
      { type: 'user', uuid: 'u2', timestamp: '2025-09-20T00:00:10.000Z', message: { content: 'second' } },
      { type: 'assistant', uuid: 'a2', timestamp: '2025-09-20T00:00:11.000Z', message: { content: 'reply to second' } }
    ]
    const file = writeTempJsonl(lines)
    const out = await mapSessionMessages(file)
    // find mapping for u1 and u2
    const u1 = out.users.find(u => u.preview.includes('first'))
    const u2 = out.users.find(u => u.preview.includes('second'))
    expect(out.mapping[u1.id].some(a => (typeof a.content === 'string' ? a.content : JSON.stringify(a.content)).includes('reply to first'))).toBeTruthy()
    expect(out.mapping[u2.id].some(a => (typeof a.content === 'string' ? a.content : JSON.stringify(a.content)).includes('reply to second'))).toBeTruthy()
  })
})
