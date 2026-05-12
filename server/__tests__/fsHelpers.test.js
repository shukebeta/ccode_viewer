const {
  mapSessionMessages,
  resolveSessionFilePath,
  extractCopilotProjectPath,
  resolveCopilotProjectPath,
  extractCodexProjectPath,
  shouldHideRawSessionEvent
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

  it('drops protocol noise events from generic session mappings', async () => {
    const lines = [
      { type: 'user', uuid: 'u1', timestamp: '2025-09-20T00:00:00.000Z', message: { content: 'first' } },
      { type: 'assistant.turn_start', timestamp: '2025-09-20T00:00:00.100Z', data: { turnId: 'turn_1' } },
      { type: 'tool.execution_start', timestamp: '2025-09-20T00:00:00.200Z', data: { toolName: 'view' } },
      { type: 'assistant.message', uuid: 'a1', timestamp: '2025-09-20T00:00:01.000Z', data: { content: 'reply to first' } }
    ]

    const out = await mapSessionMessages(writeTempJsonl(lines))
    const userId = out.users[0].id

    expect(out.mapping[userId]).toHaveLength(1)
    expect(JSON.stringify(out.mapping[userId][0].content)).toContain('reply to first')
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

  it('maps Codex input_image blocks without leaking data urls into user previews', async () => {
    const { file } = writeTempCodexSession([
      {
        timestamp: '2026-05-02T00:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'codex-image-test',
          timestamp: '2026-05-02T00:00:00.000Z',
          cwd: '/tmp/codex-image-test'
        }
      },
      {
        timestamp: '2026-05-02T00:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [
            { type: 'text', text: '<image name=[Image #1]>' },
            { type: 'input_image', image_url: 'data:image/png;base64,abc123' }
          ]
        }
      },
      {
        timestamp: '2026-05-02T00:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'got it' }]
        }
      }
    ])

    const out = await mapSessionMessages(file)

    expect(out.users).toHaveLength(1)
    expect(out.users[0].preview).toBe('[Image #1] [Image]')
    expect(out.users[0].preview).not.toContain('data:image/png')
    expect(out.mapping[out.users[0].id]).toHaveLength(1)
    expect(JSON.stringify(out.users[0].content)).toContain('"type":"input_image"')
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

  it('maps Codex reasoning blocks to thinking placeholders', async () => {
    const { file } = writeTempCodexSession([
      {
        timestamp: '2026-05-02T00:00:00.000Z',
        type: 'session_meta',
        payload: { id: 'reasoning-test', timestamp: '2026-05-02T00:00:00.000Z', cwd: '/tmp/test' }
      },
      {
        timestamp: '2026-05-02T00:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'think about it' }]
        }
      },
      {
        timestamp: '2026-05-02T00:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'reasoning',
          summary: ['step 1', 'step 2'],
          encrypted_content: 'abc123'
        }
      },
      {
        timestamp: '2026-05-02T00:00:03.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'answer' }]
        }
      }
    ])

    const out = await mapSessionMessages(file)
    const userId = out.users[0].id
    const entries = out.mapping[userId]

    const thinking = entries.find(e =>
      Array.isArray(e.content) && e.content.some(c => c.type === 'thinking')
    )
    expect(thinking).toBeDefined()
    expect(JSON.stringify(thinking.content)).toContain('step 1\\nstep 2')
  })

  it('skips Codex reasoning blocks with empty or missing summary', async () => {
    const { file } = writeTempCodexSession([
      {
        timestamp: '2026-05-02T00:00:00.000Z',
        type: 'session_meta',
        payload: { id: 'empty-reasoning-test', timestamp: '2026-05-02T00:00:00.000Z', cwd: '/tmp/test' }
      },
      {
        timestamp: '2026-05-02T00:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hello' }]
        }
      },
      {
        timestamp: '2026-05-02T00:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'reasoning',
          summary: [],
          encrypted_content: 'abc123'
        }
      },
      {
        timestamp: '2026-05-02T00:00:03.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'answer' }]
        }
      }
    ])

    const out = await mapSessionMessages(file)
    const userId = out.users[0].id
    const entries = out.mapping[userId]

    expect(entries.every(e =>
      !Array.isArray(e.content) || !e.content.some(c => c.type === 'thinking')
    )).toBe(true)
    expect(entries.some(e => JSON.stringify(e.content).includes('answer'))).toBe(true)
  })

  it('maps Codex custom_tool_call with patch_apply_end result', async () => {
    const { file } = writeTempCodexSession([
      {
        timestamp: '2026-05-02T00:00:00.000Z',
        type: 'session_meta',
        payload: { id: 'custom-tool-test', timestamp: '2026-05-02T00:00:00.000Z', cwd: '/tmp/test' }
      },
      {
        timestamp: '2026-05-02T00:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'apply the patch' }]
        }
      },
      {
        timestamp: '2026-05-02T00:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          call_id: 'call_patch_1',
          name: 'apply_patch',
          input: '*** Begin Patch\n*** Update File: foo.js\n@@\n-old\n+new'
        }
      },
      {
        timestamp: '2026-05-02T00:00:03.000Z',
        type: 'event_msg',
        payload: {
          type: 'patch_apply_end',
          call_id: 'call_patch_1',
          stdout: 'Success. Updated the following files:\nM foo.js',
          stderr: '',
          success: true,
          changes: { 'foo.js': { type: 'update' } }
        }
      }
    ])

    const out = await mapSessionMessages(file)
    const userId = out.users[0].id
    const entries = out.mapping[userId]

    const toolEntry = entries.find(e =>
      Array.isArray(e.content) && e.content.some(c => c.type === 'tool_use')
    )
    expect(toolEntry).toBeDefined()
    expect(JSON.stringify(toolEntry.content)).toContain('"name":"ApplyPatch"')
    expect(JSON.stringify(toolEntry.content)).toContain('Patch applied')
    expect(JSON.stringify(toolEntry.content)).toContain('foo.js')
  })

  it('maps Codex custom_tool_call with custom_tool_call_output when no patch event', async () => {
    const { file } = writeTempCodexSession([
      {
        timestamp: '2026-05-02T00:00:00.000Z',
        type: 'session_meta',
        payload: { id: 'custom-output-test', timestamp: '2026-05-02T00:00:00.000Z', cwd: '/tmp/test' }
      },
      {
        timestamp: '2026-05-02T00:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'use mcp tool' }]
        }
      },
      {
        timestamp: '2026-05-02T00:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          call_id: 'call_mcp_1',
          name: 'my_mcp_tool',
          input: { query: 'something' }
        }
      },
      {
        timestamp: '2026-05-02T00:00:03.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call_mcp_1',
          output: 'mcp result here'
        }
      }
    ])

    const out = await mapSessionMessages(file)
    const userId = out.users[0].id
    const entries = out.mapping[userId]

    const toolEntry = entries.find(e =>
      Array.isArray(e.content) && e.content.some(c => c.type === 'tool_use')
    )
    expect(toolEntry).toBeDefined()
    expect(JSON.stringify(toolEntry.content)).toContain('"name":"my_mcp_tool"')
    expect(JSON.stringify(toolEntry.content)).toContain('mcp result here')
  })

  it('preserves unique Codex agent_message events as assistant text', async () => {
    const { file } = writeTempCodexSession([
      {
        timestamp: '2026-05-02T00:00:00.000Z',
        type: 'session_meta',
        payload: { id: 'agent-commentary-test', timestamp: '2026-05-02T00:00:00.000Z', cwd: '/tmp/test' }
      },
      {
        timestamp: '2026-05-02T00:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hello' }]
        }
      },
      {
        timestamp: '2026-05-02T00:00:02.000Z',
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: 'working through the files now',
          phase: 'commentary'
        }
      }
    ])

    const out = await mapSessionMessages(file)
    const userId = out.users[0].id
    const entries = out.mapping[userId]

    expect(entries).toHaveLength(1)
    expect(JSON.stringify(entries[0].content)).toContain('working through the files now')
  })

  it('skips duplicate Codex agent_message events when assistant response_item has same text', async () => {
    const { file } = writeTempCodexSession([
      {
        timestamp: '2026-05-02T00:00:00.000Z',
        type: 'session_meta',
        payload: { id: 'agent-dup-test', timestamp: '2026-05-02T00:00:00.000Z', cwd: '/tmp/test' }
      },
      {
        timestamp: '2026-05-02T00:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hello' }]
        }
      },
      {
        timestamp: '2026-05-02T00:00:02.000Z',
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: 'duplicate content',
          phase: 'commentary'
        }
      },
      {
        timestamp: '2026-05-02T00:00:03.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'duplicate content' }]
        }
      }
    ])

    const out = await mapSessionMessages(file)
    const userId = out.users[0].id
    const entries = out.mapping[userId]

    // Should only have the response_item version, not the agent_message version
    const matching = entries.filter(e => JSON.stringify(e.content).includes('duplicate content'))
    expect(matching).toHaveLength(1)
  })

  it('maps Codex collab events as status text', async () => {
    const { file } = writeTempCodexSession([
      {
        timestamp: '2026-05-02T00:00:00.000Z',
        type: 'session_meta',
        payload: { id: 'collab-test', timestamp: '2026-05-02T00:00:00.000Z', cwd: '/tmp/test' }
      },
      {
        timestamp: '2026-05-02T00:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'spawn an agent' }]
        }
      },
      {
        timestamp: '2026-05-02T00:00:02.000Z',
        type: 'event_msg',
        payload: {
          type: 'collab_agent_spawn_end',
          call_id: 'call_spawn_1',
          new_agent_nickname: 'Worker1',
          new_agent_role: 'worker',
          prompt: 'do the thing'
        }
      },
      {
        timestamp: '2026-05-02T00:00:03.000Z',
        type: 'event_msg',
        payload: {
          type: 'collab_waiting_end',
          call_id: 'call_spawn_1',
          statuses: {}
        }
      },
      {
        timestamp: '2026-05-02T00:00:04.000Z',
        type: 'event_msg',
        payload: {
          type: 'collab_close_end',
          call_id: 'call_spawn_1',
          receiver_agent_nickname: 'Worker1'
        }
      }
    ])

    const out = await mapSessionMessages(file)
    const userId = out.users[0].id
    const entries = out.mapping[userId]

    const allText = JSON.stringify(entries)
    expect(allText).toContain('"type":"status"')
    expect(allText).toContain('Spawned agent Worker1')
    expect(allText).toContain('Waiting on agents')
    expect(allText).toContain('Closed agent Worker1')
  })
})

describe('shouldHideRawSessionEvent', () => {
  it('classifies protocol lifecycle events as hidden noise', () => {
    expect(shouldHideRawSessionEvent({ type: 'assistant.turn_start' })).toBe(true)
    expect(shouldHideRawSessionEvent({ type: 'tool.execution_complete' })).toBe(true)
    expect(shouldHideRawSessionEvent({ type: 'hook.start' })).toBe(true)
  })

  it('keeps conversational events visible', () => {
    expect(shouldHideRawSessionEvent({ type: 'assistant.message' })).toBe(false)
    expect(shouldHideRawSessionEvent({ type: 'tool_result' })).toBe(false)
    expect(shouldHideRawSessionEvent({ type: 'user' })).toBe(false)
  })
})
