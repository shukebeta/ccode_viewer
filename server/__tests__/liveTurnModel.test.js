const {
  classifyIncomingMessage,
  assignAssistantToUser,
  mergeIntegratedMessage,
  NO_USER_KEY
} = require('../../shared/liveTurnModel')

function freshState() {
  return { users: [], mapping: {} }
}

describe('liveTurnModel.mergeIntegratedMessage', () => {
  test('(a) plain user prompt appends a user entry', () => {
    const state = freshState()
    const result = mergeIntegratedMessage(state, {
      type: 'user',
      uuid: 'u1',
      timestamp: '2025-01-01T00:00:00Z',
      message: { role: 'user', content: 'hi there' }
    })

    expect(result).toEqual({ kind: 'append-user', userId: 'u1' })
    expect(state.users).toHaveLength(1)
    expect(state.users[0].id).toBe('u1')
    expect(state.mapping['u1']).toEqual([])
  })

  test('(b) assistant text with explicit parentUuid attaches to that user', () => {
    const state = freshState()
    mergeIntegratedMessage(state, {
      type: 'user',
      uuid: 'u1',
      timestamp: '2025-01-01T00:00:00Z',
      message: { role: 'user', content: 'hi' }
    })

    const result = mergeIntegratedMessage(state, {
      type: 'assistant',
      uuid: 'a1',
      parentUuid: 'u1',
      timestamp: '2025-01-01T00:00:01Z',
      message: { role: 'assistant', content: 'hello back' }
    })

    expect(result).toEqual({ kind: 'append-assistant', userId: 'u1' })
    expect(state.mapping['u1']).toHaveLength(1)
    expect(state.mapping['u1'][0].id).toBe('a1')
  })

  test('(c) assistant with no parentUuid resolves to closest preceding user by timestamp, then index fallback', () => {
    const tsState = freshState()
    mergeIntegratedMessage(tsState, {
      type: 'user',
      uuid: 'u_early',
      timestamp: '2025-01-01T00:00:00Z',
      message: { role: 'user', content: 'first' }
    })
    mergeIntegratedMessage(tsState, {
      type: 'user',
      uuid: 'u_late',
      timestamp: '2025-01-01T00:00:10Z',
      message: { role: 'user', content: 'second' }
    })

    const tsResult = mergeIntegratedMessage(tsState, {
      type: 'assistant',
      uuid: 'a_ts',
      timestamp: '2025-01-01T00:00:15Z',
      message: { role: 'assistant', content: 'reply' }
    })

    expect(tsResult).toEqual({ kind: 'append-assistant', userId: 'u_late' })
    expect(tsState.mapping['u_late']).toHaveLength(1)
    expect(tsState.mapping['u_early']).toHaveLength(0)

    const idxState = freshState()
    mergeIntegratedMessage(idxState, {
      type: 'user',
      uuid: 'u_a',
      message: { role: 'user', content: 'a' }
    })
    mergeIntegratedMessage(idxState, {
      type: 'user',
      uuid: 'u_b',
      message: { role: 'user', content: 'b' }
    })

    const idxResult = mergeIntegratedMessage(idxState, {
      type: 'assistant',
      uuid: 'a_idx',
      message: { role: 'assistant', content: 'reply' }
    })

    expect(idxResult).toEqual({ kind: 'append-assistant', userId: 'u_b' })
  })

  test('(d) tool_result with parentUuid matching an existing assistant merges into the parent', () => {
    const state = freshState()
    mergeIntegratedMessage(state, {
      type: 'user',
      uuid: 'u1',
      message: { role: 'user', content: 'run a tool' }
    })
    mergeIntegratedMessage(state, {
      type: 'assistant',
      uuid: 'a1',
      parentUuid: 'u1',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }]
      }
    })

    const before = state.mapping['u1'][0]
    const initialUserCount = state.users.length
    const initialAssistantCount = state.mapping['u1'].length

    const result = mergeIntegratedMessage(state, {
      type: 'tool_result',
      uuid: 'tr1',
      parentUuid: 'a1',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] }
    })

    expect(result).toEqual({ kind: 'merge-into-parent', assistantId: 'a1' })
    expect(state.users.length).toBe(initialUserCount)
    expect(state.mapping['u1'].length).toBe(initialAssistantCount)
    expect(Array.isArray(before.content)).toBe(true)
    expect(before.content.length).toBeGreaterThan(1)
  })

  test('(e) isMeta user is reclassified to assistant and assigned to most recent user', () => {
    const state = freshState()
    mergeIntegratedMessage(state, {
      type: 'user',
      uuid: 'u1',
      timestamp: '2025-01-01T00:00:00Z',
      message: { role: 'user', content: 'first turn' }
    })

    const result = mergeIntegratedMessage(state, {
      type: 'user',
      uuid: 'meta1',
      isMeta: true,
      timestamp: '2025-01-01T00:00:05Z',
      message: { role: 'user', content: '<command-message>/help</command-message>' }
    })

    expect(result.kind).toBe('append-assistant')
    expect(result.userId).toBe('u1')
    expect(state.users).toHaveLength(1)
    expect(state.mapping['u1']).toHaveLength(1)
    expect(state.mapping['u1'][0].id).toBe('meta1')
  })

  test('(f) message matching detectNoiseWrapper is dropped without mutation', () => {
    const state = freshState()
    mergeIntegratedMessage(state, {
      type: 'user',
      uuid: 'u1',
      message: { role: 'user', content: 'real prompt' }
    })

    const snapshotUsers = state.users.slice()
    const snapshotMapping = JSON.parse(JSON.stringify(state.mapping))

    const result = mergeIntegratedMessage(state, {
      type: 'user',
      isMeta: true,
      uuid: 'noise1',
      message: {
        role: 'user',
        content: '<local-command-caveat>Caveat: the messages below were generated...</local-command-caveat>'
      }
    })

    expect(result).toEqual({ kind: 'drop' })
    expect(state.users).toEqual(snapshotUsers)
    expect(state.mapping).toEqual(snapshotMapping)
  })

  test('(g) tool_result arriving before any user falls through to __no_user__', () => {
    const state = freshState()
    const result = mergeIntegratedMessage(state, {
      type: 'tool_result',
      uuid: 'tr_orphan',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tu_missing', content: 'orphan' }] }
    })

    expect(result).toEqual({ kind: 'append-assistant', userId: NO_USER_KEY })
    expect(state.users).toHaveLength(0)
    expect(state.mapping[NO_USER_KEY]).toHaveLength(1)
    expect(state.mapping[NO_USER_KEY][0].id).toBe('tr_orphan')
  })

  test('(h) hidden raw session event types are dropped without mutation', () => {
    const state = freshState()
    mergeIntegratedMessage(state, {
      type: 'user',
      uuid: 'u1',
      message: { role: 'user', content: 'hi' }
    })

    const snapshotUsers = state.users.slice()
    const snapshotMapping = JSON.parse(JSON.stringify(state.mapping))

    const result = mergeIntegratedMessage(state, {
      type: 'tool.execution_start',
      uuid: 'hidden1'
    })

    expect(result).toEqual({ kind: 'drop' })
    expect(state.users).toEqual(snapshotUsers)
    expect(state.mapping).toEqual(snapshotMapping)
  })
})

describe('liveTurnModel.classifyIncomingMessage', () => {
  test('drops null / non-object inputs', () => {
    expect(classifyIncomingMessage(null).kind).toBe('drop')
    expect(classifyIncomingMessage(undefined).kind).toBe('drop')
    expect(classifyIncomingMessage('string').kind).toBe('drop')
  })

  test('classifies user messages without isMeta as user', () => {
    expect(classifyIncomingMessage({ type: 'user', uuid: 'u1', message: { content: 'hi' } }).kind).toBe('user')
  })

  test('promotes nested tool_use content to assistant even when raw type is missing', () => {
    const result = classifyIncomingMessage({
      uuid: 'x1',
      message: {
        role: 'user',
        content: [{ type: 'tool_use', id: 't1', name: 'Bash' }]
      }
    })
    expect(result.kind).toBe('assistant')
  })
})

describe('liveTurnModel.assignAssistantToUser', () => {
  test('parentUuid pointing to a user wins over assistant merge', () => {
    const users = [{ id: 'u1', timestamp: '2025-01-01T00:00:00Z' }]
    const mapping = { u1: [{ id: 'u1', raw: { uuid: 'u1' } }] }
    const result = assignAssistantToUser({
      users,
      mapping,
      classified: { id: 'a1', parentUuid: 'u1', rawType: 'tool_result', timestamp: null }
    })
    expect(result).toEqual({ userId: 'u1' })
  })
})
