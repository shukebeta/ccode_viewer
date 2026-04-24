const SKILL_PREFIX = 'Base directory for this skill:'
const CURRENT_DATETIME_TAG_RE = /<current_datetime>[\s\S]*?<\/current_datetime>\s*/gi

function stripCurrentDatetimeTags(text) {
  if (typeof text !== 'string') return ''
  return text.replace(CURRENT_DATETIME_TAG_RE, '').trim()
}

function isSkillContentText(text) {
  if (typeof text !== 'string') return false
  return stripCurrentDatetimeTags(text).startsWith(SKILL_PREFIX)
}

function extractLeadingJsonValue(text) {
  if (typeof text !== 'string') return null

  const trimmed = text.trimStart()
  if (!trimmed || (trimmed[0] !== '[' && trimmed[0] !== '{')) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '[' || ch === '{') {
      depth++
      continue
    }

    if (ch === ']' || ch === '}') {
      depth--
      if (depth === 0) {
        return {
          jsonText: trimmed.slice(0, i + 1),
          restText: trimmed.slice(i + 1).trim()
        }
      }
      if (depth < 0) return null
    }
  }

  return null
}

function getTextFieldValue(value) {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  if (typeof value.text === 'string') return value.text
  if (typeof value.content === 'string') return value.content
  return ''
}

function collectSkillTextsFromPayload(value) {
  if (Array.isArray(value)) {
    const collected = []
    for (const item of value) {
      const nested = collectSkillTextsFromPayload(item)
      if (nested == null) return null
      collected.push(...nested)
    }
    return collected
  }

  const text = stripCurrentDatetimeTags(getTextFieldValue(value))
  if (!text) return []
  if (isSkillContentText(text)) return [text]
  return null
}

function extractLeadingSkillPayload(text) {
  if (typeof text !== 'string') {
    return { skillText: '', remainderText: '', cleanedText: '' }
  }

  const cleanedText = stripCurrentDatetimeTags(text)
  if (!cleanedText) {
    return { skillText: '', remainderText: '', cleanedText: '' }
  }

  const jsonValue = extractLeadingJsonValue(cleanedText)
  if (jsonValue) {
    try {
      const parsed = JSON.parse(jsonValue.jsonText)
      const skillTexts = collectSkillTextsFromPayload(parsed)
      if (skillTexts && skillTexts.length > 0) {
        return {
          skillText: skillTexts.join('\n\n'),
          remainderText: jsonValue.restText,
          cleanedText
        }
      }
    } catch (err) {
      // Ignore invalid leading JSON and fall back to plain-text checks.
    }
  }

  if (isSkillContentText(cleanedText)) {
    return { skillText: cleanedText, remainderText: '', cleanedText }
  }

  return { skillText: '', remainderText: cleanedText, cleanedText }
}

function cloneWithText(value, key, text) {
  if (!value || typeof value !== 'object') return text
  return { ...value, [key]: text }
}

function getUserSidebarContent(content) {
  if (Array.isArray(content)) {
    const filtered = content
      .map(item => getUserSidebarContent(item))
      .filter(item => !isEmptyContent(item))

    return filtered.length > 0 ? filtered : ''
  }

  if (typeof content === 'string') {
    return extractLeadingSkillPayload(content).remainderText
  }

  if (!content || typeof content !== 'object') return content

  if (typeof content.text === 'string') {
    const nextText = extractLeadingSkillPayload(content.text).remainderText
    if (!nextText) return null
    return nextText === content.text ? content : cloneWithText(content, 'text', nextText)
  }

  if (typeof content.content === 'string') {
    const nextText = extractLeadingSkillPayload(content.content).remainderText
    if (!nextText) return null
    return nextText === content.content ? content : cloneWithText(content, 'content', nextText)
  }

  return content
}

function isEmptyContent(content) {
  if (content == null) return true
  if (typeof content === 'string') return !content.trim()
  if (Array.isArray(content)) return content.length === 0 || content.every(isEmptyContent)
  if (typeof content !== 'object') return false
  if (content.type === 'image') return false
  if (typeof content.text === 'string') return !content.text.trim()
  if (typeof content.content === 'string') return !content.content.trim()
  return false
}

function extractPlainText(content) {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(item => extractPlainText(item))
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  if (typeof content !== 'object') return String(content)
  if (content.toolUseResult && content.toolUseResult.content != null) {
    const toolUseResultText = extractPlainText(content.toolUseResult.content)
    if (toolUseResultText) return toolUseResultText
  }
  if (content.type === 'image') return '[Image]'
  if (content.type === 'thinking') {
    const thinkingText = typeof content.thinking === 'string' ? content.thinking.trim() : ''
    return thinkingText || 'thinking...'
  }
  if (typeof content.text === 'string') return content.text
  if (typeof content.content === 'string') return content.content
  if (content.content && typeof content.content === 'object') {
    const nestedContentText = extractPlainText(content.content)
    if (nestedContentText) return nestedContentText
  }
  if (content.message) {
    const messageText = extractPlainText(content.message.content ?? content.message.text ?? content.message)
    if (messageText) return messageText
  }
  if (content.result && content.result.content != null) {
    const resultText = extractPlainText(content.result.content)
    if (resultText) return resultText
  }
  if (typeof content.thinking === 'string') return content.thinking
  try {
    return JSON.stringify(content)
  } catch (err) {
    return ''
  }
}

function getUserPreviewText(content) {
  const sidebarContent = getUserSidebarContent(content)
  return extractPlainText(sidebarContent).replace(/\s+/g, ' ').trim()
}

function hasUserVisibleContent(content) {
  return Boolean(getUserPreviewText(content))
}

function getSkillContentSummary(text) {
  const cleaned = stripCurrentDatetimeTags(text)
  const headingMatch = cleaned.match(/^#\s+(.+)$/m)
  if (headingMatch && headingMatch[1]) {
    return `Skill content: ${headingMatch[1].trim()}`
  }

  const firstLine = cleaned
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean)

  return firstLine || 'Skill content'
}

const messageContentUtils = {
  extractLeadingSkillPayload,
  extractPlainText,
  getSkillContentSummary,
  getUserPreviewText,
  getUserSidebarContent,
  hasUserVisibleContent,
  isSkillContentText,
  stripCurrentDatetimeTags
}

if (typeof globalThis !== 'undefined') {
  globalThis.__ccodeViewerMessageContentUtils = messageContentUtils
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = messageContentUtils
}
