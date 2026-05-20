;(function () {
  let messageContentUtils

  if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
    try {
      messageContentUtils = require('./messageContent')
    } catch (e) {
      messageContentUtils = null
    }
  }

  if (!messageContentUtils && typeof globalThis !== 'undefined') {
    messageContentUtils = globalThis.__ccodeViewerMessageContentUtils
  }

  if (!messageContentUtils
      || typeof messageContentUtils.detectNoiseWrapper !== 'function'
      || typeof messageContentUtils.shouldHideRawSessionEvent !== 'function') {
    throw new Error('liveTurnModel: shared/messageContent.js must be loaded first')
  }

  const { detectNoiseWrapper, shouldHideRawSessionEvent } = messageContentUtils

  const NO_USER_KEY = '__no_user__'

  function classifyIncomingMessage(rawMsg) {
    if (!rawMsg || typeof rawMsg !== 'object') return { kind: 'drop' }
    if (shouldHideRawSessionEvent(rawMsg)) return { kind: 'drop' }
    if (detectNoiseWrapper(rawMsg)) return { kind: 'drop' }

    const rawType = rawMsg.type
    const id = rawMsg.uuid
      || (rawMsg.message && rawMsg.message.id)
      || rawMsg.id
      || `i_${Date.now()}`
    const parentUuid = rawMsg.parentUuid || rawMsg.parentId || null
    const timestamp = rawMsg.timestamp
      || (rawMsg.message && rawMsg.message.timestamp)
      || null
    const content = (rawMsg.message && (rawMsg.message.content || rawMsg.message))
      || rawMsg.content
      || rawMsg

    let kind = null

    if (rawType === 'user' && rawMsg.isMeta === true) {
      kind = 'assistant'
    } else if (rawType === 'tool_use' || rawType === 'tool_result' || rawType === 'tool') {
      kind = 'assistant'
    } else if (typeof rawType === 'string' && rawType.startsWith('tool')) {
      kind = 'assistant'
    } else {
      const contentCandidate = (rawMsg.message && rawMsg.message.content) || rawMsg.content
      if (Array.isArray(contentCandidate)) {
        for (const item of contentCandidate) {
          if (item && (item.type === 'tool_use' || item.type === 'tool_result' || item.type === 'tool')) {
            kind = 'assistant'
            break
          }
        }
      }
      if (!kind) {
        if (rawType === 'user') {
          kind = 'user'
        } else {
          const role = rawMsg.message && rawMsg.message.role
          kind = role || rawType
        }
      }
    }

    if (kind !== 'user' && kind !== 'assistant') return { kind: 'drop' }

    return { kind, id, parentUuid, timestamp, content, rawType }
  }

  function findUserById(users, lookupId) {
    if (!lookupId) return null
    for (const u of users) {
      if (u.id === lookupId) return u
      if (u.raw && u.raw.uuid === lookupId) return u
    }
    return null
  }

  function findAssistantById(mapping, lookupId) {
    if (!lookupId) return null
    for (const arr of Object.values(mapping)) {
      for (const a of arr) {
        if (a.id === lookupId) return a
        if (a.raw && a.raw.uuid === lookupId) return a
      }
    }
    return null
  }

  function assignAssistantToUser({ users, mapping, classified }) {
    const { parentUuid, timestamp, rawType } = classified

    if (parentUuid) {
      const matchedUser = findUserById(users, parentUuid)
      if (matchedUser) return { userId: matchedUser.id }
    }

    if (rawType === 'tool_result' && parentUuid) {
      const parentAssistant = findAssistantById(mapping, parentUuid)
      if (parentAssistant) return { mergeIntoAssistantId: parentAssistant.id }
    }

    if (timestamp) {
      const aTs = new Date(timestamp).getTime()
      if (!Number.isNaN(aTs)) {
        let candidate = null
        let candidateTs = -Infinity
        for (const u of users) {
          if (!u.timestamp) continue
          const uTs = new Date(u.timestamp).getTime()
          if (Number.isNaN(uTs)) continue
          if (uTs <= aTs && uTs > candidateTs) {
            candidate = u
            candidateTs = uTs
          }
        }
        if (candidate) return { userId: candidate.id }
      }
    }

    if (users.length > 0) {
      return { userId: users[users.length - 1].id }
    }

    return { userId: NO_USER_KEY }
  }

  function mergeIntegratedMessage(state, rawMsg) {
    const classified = classifyIncomingMessage(rawMsg)
    if (classified.kind === 'drop') return { kind: 'drop' }

    if (classified.kind === 'user') {
      const userEntry = {
        id: classified.id,
        content: classified.content,
        timestamp: classified.timestamp,
        rawType: classified.rawType,
        raw: rawMsg
      }
      state.users.push(userEntry)
      if (!state.mapping[classified.id]) state.mapping[classified.id] = []
      return { kind: 'append-user', userId: classified.id }
    }

    const assignment = assignAssistantToUser({
      users: state.users,
      mapping: state.mapping,
      classified
    })

    if (assignment.mergeIntoAssistantId) {
      const parentAssistant = findAssistantById(state.mapping, assignment.mergeIntoAssistantId)
      if (parentAssistant) {
        if (Array.isArray(parentAssistant.content)) {
          parentAssistant.content.push(classified.content)
        } else {
          parentAssistant.content = [parentAssistant.content, classified.content]
        }
        return { kind: 'merge-into-parent', assistantId: parentAssistant.id }
      }
    }

    const targetUserId = assignment.userId
    const assistantEntry = {
      id: classified.id,
      content: classified.content,
      timestamp: classified.timestamp,
      raw: rawMsg
    }

    if (!state.mapping[targetUserId]) state.mapping[targetUserId] = []
    state.mapping[targetUserId].push(assistantEntry)

    return { kind: 'append-assistant', userId: targetUserId }
  }

  const liveTurnModel = {
    classifyIncomingMessage,
    assignAssistantToUser,
    mergeIntegratedMessage,
    NO_USER_KEY
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.__ccodeViewerLiveTurnModel = liveTurnModel
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = liveTurnModel
  }
})()
