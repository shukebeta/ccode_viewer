const fs = require('fs')
const os = require('os')
const path = require('path')

const { _private } = require('../fileWatcher')

function writeTempSession(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-watcher-test-'))
  const file = path.join(dir, 'session.jsonl')
  fs.writeFileSync(file, lines.map(line => JSON.stringify(line)).join('\n'))
  return { dir, file }
}

describe('fileWatcher codex normalization', () => {
  it('detects Codex session files from session metadata', () => {
    const { file } = writeTempSession([
      {
        timestamp: '2026-05-02T00:00:00.000Z',
        type: 'session_meta',
        payload: { id: 'codex-test', cwd: '/tmp/codex-test' }
      }
    ])

    expect(_private.detectSessionFormat(file)).toBe('codex')
  })

  it('drops raw Codex internal event lines during live updates', () => {
    const rawLine = JSON.stringify({
      timestamp: '2026-05-02T00:00:01.000Z',
      type: 'assistant.turn_start',
      data: { turnId: 'turn_1' }
    })

    const normalized = _private.normalizeAppendedLine(JSON.parse(rawLine), rawLine, 'codex')

    expect(normalized).toBeNull()
  })

  it('normalizes Codex live tool output into mergeable tool_result blocks', () => {
    const raw = {
      timestamp: '2026-05-02T00:00:03.000Z',
      type: 'event_msg',
      payload: {
        type: 'exec_command_end',
        call_id: 'call_read_1',
        aggregated_output: 'README contents'
      }
    }

    const normalized = _private.normalizeAppendedLine(raw, JSON.stringify(raw), 'codex')

    expect(normalized).toBeTruthy()

    const parsed = JSON.parse(normalized)
    expect(parsed.type).toBe('tool_result')
    expect(parsed.parentUuid).toBe('call_read_1')
    expect(parsed.content).toEqual({
      type: 'tool_result',
      tool_use_id: 'call_read_1',
      content: 'README contents'
    })
  })

  it('normalizes Codex live exec_command calls into renderable tool_use blocks', () => {
    const raw = {
      timestamp: '2026-05-02T00:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        call_id: 'call_exec_1',
        name: 'exec_command',
        arguments: JSON.stringify({
          cmd: "sed -n '1,20p' README.md",
          justification: 'Read the README'
        })
      }
    }

    const normalized = _private.normalizeAppendedLine(raw, JSON.stringify(raw), 'codex')

    expect(normalized).toBeTruthy()

    const parsed = JSON.parse(normalized)
    expect(parsed.type).toBe('assistant')
    expect(parsed.content).toEqual([{
      type: 'tool_use',
      id: 'call_exec_1',
      name: 'Bash',
      input: {
        command: "sed -n '1,20p' README.md",
        description: 'Read the README'
      }
    }])
  })

  it('maps known session sources to explicit formats', () => {
    expect(_private.sourceToSessionFormat('codex')).toBe('codex')
    expect(_private.sourceToSessionFormat('gcopilot')).toBeNull()
    expect(_private.sourceToSessionFormat('claudecode')).toBeNull()
    expect(_private.sourceToSessionFormat(null)).toBeNull()
  })

  it('drops generic protocol noise lines before they reach the viewer', () => {
    const rawLine = JSON.stringify({
      timestamp: '2026-05-02T00:00:01.000Z',
      type: 'tool.execution_start',
      data: { toolName: 'view' }
    })

    const normalized = _private.normalizeAppendedLine(JSON.parse(rawLine), rawLine, 'generic')

    expect(normalized).toBeNull()
  })
})
