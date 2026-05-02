const {
  mapSessionMessages,
  resolveSessionFilePath,
  extractCopilotProjectPath,
  resolveCopilotProjectPath,
  extractCodexProjectPath
} = require('../fsHelpers')

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

function writeTempCopilotSession(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-session-'))
  const file = path.join(dir, 'events.jsonl')
  fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n'))
  return { dir, file }
}

function writeTempCodexSession(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-session-'))
  const file = path.join(dir, 'rollout-session.jsonl')
  fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n'))
  return { dir, file }
}

describe('mapSessionMessages', () => {
  it('resolves Copilot session directories to events.jsonl for shared file handling', async () => {
    const { dir, file } = writeTempCopilotSession([
      { type: 'session.start', data: { sessionId: 's1' } }
    ])

    await expect(resolveSessionFilePath(dir)).resolves.toBe(file)
    await expect(resolveSessionFilePath(file)).resolves.toBe(file)
  })

  it('extracts project paths from legacy Copilot jsonl sessions', async () => {
    const file = writeTempJsonl([
      {
        type: 'tool.execution_start',
        data: {
          toolName: 'view',
          arguments: {
            path: 'D:\\git\\xemt-core\\DFX\\Lakros.DFX.Business\\Settlements\\PromoteDisbursementValidator.cs'
          }
        }
      }
    ])

    await expect(extractCopilotProjectPath(file)).resolves.toBe('D:' + path.sep + path.join('git', 'xemt-core', 'DFX'))
    await expect(resolveCopilotProjectPath(file)).resolves.toBe('D:' + path.sep + path.join('git', 'xemt-core', 'DFX'))
  })

  it('extracts project paths from Codex session metadata', async () => {
    const { file } = writeTempCodexSession([
      {
        timestamp: '2026-05-02T00:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'codex-path-test',
          timestamp: '2026-05-02T00:00:00.000Z',
          cwd: '/tmp/codex-path-test/gridai-auto-job'
        }
      }
    ])

    await expect(extractCodexProjectPath(file)).resolves.toBe('/tmp/codex-path-test/gridai-auto-job')
  })

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

  it('removes injected skill payload text from user previews while preserving raw content', async () => {
    const lines = [
      {
        type: 'user',
        uuid: 'u1',
        timestamp: '2025-09-20T00:00:00.000Z',
        message: {
          content: [
            {
              type: 'text',
              text: 'Base directory for this skill: D:\\\\git\\\\repo\\\\.claude\\\\skills\\\\query-db\n\n# Query DB Skill\n\nUse this skill to query Oracle.'
            },
            { type: 'text', text: '真正的用户问题' }
          ]
        }
      },
      { type: 'assistant', uuid: 'a1', timestamp: '2025-09-20T00:00:01.000Z', message: { content: 'reply' } }
    ]
    const file = writeTempJsonl(lines)
    const out = await mapSessionMessages(file)

    expect(out.users[0].preview).toBe('真正的用户问题')
    expect(JSON.stringify(out.users[0].content)).toContain('Base directory for this skill:')
    expect(out.mapping[out.users[0].id].length).toBe(1)
  })

  it('treats meta slash-command skill prompts as assistant content mapped to the command', async () => {
    const lines = [
      {
        type: 'user',
        uuid: 'u1',
        timestamp: '2025-09-20T00:00:00.000Z',
        message: { content: '<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>3504</command-args>' }
      },
      {
        type: 'user',
        uuid: 'meta1',
        parentUuid: 'u1',
        isMeta: true,
        timestamp: '2025-09-20T00:00:01.000Z',
        message: {
          content: [
            {
              type: 'text',
              text: 'You are an expert code reviewer. Follow these steps:\n\nPR number: 3504'
            }
          ]
        }
      },
      {
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2025-09-20T00:00:02.000Z',
        message: { content: 'PR Review feedback\n- Looks good overall.' }
      }
    ]
    const file = writeTempJsonl(lines)
    const out = await mapSessionMessages(file)

    expect(out.users).toHaveLength(1)
    expect(out.users[0].id).toBe('u1')
    expect(out.mapping.u1).toBeDefined()
    expect(out.mapping.u1).toHaveLength(2)
    expect(JSON.stringify(out.mapping.u1[0].content)).toContain('expert code reviewer')
    expect(JSON.stringify(out.mapping.u1[1].content)).toContain('PR Review feedback')
  })

  it('maps Codex sessions and strips environment context from user previews', async () => {
    const { file } = writeTempCodexSession([
      {
        timestamp: '2026-05-02T00:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'codex-mapping-test',
          timestamp: '2026-05-02T00:00:00.000Z',
          cwd: '/tmp/codex-mapping-test'
        }
      },
      {
        timestamp: '2026-05-02T00:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: '<environment_context>\n  <cwd>/tmp/codex-mapping-test</cwd>\n</environment_context>'
            },
            { type: 'input_text', text: 'actual codex prompt' }
          ]
        }
      },
      {
        timestamp: '2026-05-02T00:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'assistant answer' }]
        }
      }
    ])

    const out = await mapSessionMessages(file)

    expect(out.users).toHaveLength(1)
    expect(out.users[0].preview).toBe('actual codex prompt')
    expect(JSON.stringify(out.users[0].content)).not.toContain('environment_context')
    expect(out.mapping[out.users[0].id]).toHaveLength(1)
    expect(JSON.stringify(out.mapping[out.users[0].id][0].content)).toContain('assistant answer')
  })

  it('normalizes Codex exec_command tool calls using exec_command_end output', async () => {
    const { file } = writeTempCodexSession([
      {
        timestamp: '2026-05-02T00:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'codex-tool-test',
          timestamp: '2026-05-02T00:00:00.000Z',
          cwd: '/tmp/codex-tool-test'
        }
      },
      {
        timestamp: '2026-05-02T00:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'show me the file' }]
        }
      },
      {
        timestamp: '2026-05-02T00:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          call_id: 'call_read_1',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: "sed -n '1,20p' README.md",
            workdir: '/tmp/codex-tool-test'
          })
        }
      },
      {
        timestamp: '2026-05-02T00:00:03.000Z',
        type: 'event_msg',
        payload: {
          type: 'exec_command_end',
          call_id: 'call_read_1',
          parsed_cmd: [
            {
              type: 'read',
              cmd: "sed -n '1,20p' README.md",
              name: 'README.md',
              path: 'README.md'
            }
          ],
          aggregated_output: 'README contents',
          exit_code: 0
        }
      }
    ])

    const out = await mapSessionMessages(file)
    const userId = out.users[0].id
    const assistantEntries = out.mapping[userId]

    expect(assistantEntries).toHaveLength(1)
    expect(JSON.stringify(assistantEntries[0].content)).toContain('"name":"Read"')
    expect(JSON.stringify(assistantEntries[0].content)).toContain('README contents')
  })

  it('skips Codex update_plan with empty content instead of creating broken tool_use blocks', async () => {
    const { file } = writeTempCodexSession([
      {
        timestamp: '2026-05-02T00:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'codex-empty-plan-test',
          timestamp: '2026-05-02T00:00:00.000Z',
          cwd: '/tmp/empty-plan-test'
        }
      },
      {
        timestamp: '2026-05-02T00:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'do something' }]
        }
      },
      {
        timestamp: '2026-05-02T00:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          call_id: 'call_plan_empty',
          name: 'update_plan',
          arguments: '{}'
        }
      },
      {
        timestamp: '2026-05-02T00:00:03.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'done' }]
        }
      }
    ])

    const out = await mapSessionMessages(file)
    const userId = out.users[0].id
    const entries = out.mapping[userId]

    const brokenToolUse = entries.find(e =>
      Array.isArray(e.content) && e.content.some(c => c.type === 'tool_use' && !c.name)
    )
    expect(brokenToolUse).toBeUndefined()
    expect(entries.some(e => JSON.stringify(e.content).includes('done'))).toBe(true)
  })
})
