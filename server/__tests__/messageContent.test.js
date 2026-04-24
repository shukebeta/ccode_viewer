const {
  extractLeadingSkillPayload,
  extractPlainText,
  getUserPreviewText,
  getUserSidebarContent,
  hasUserVisibleContent
} = require('../../shared/messageContent')

describe('messageContent skill handling', () => {
  it('removes skill text blocks from sidebar content arrays', () => {
    const content = [
      {
        type: 'text',
        text: 'Base directory for this skill: D:\\\\git\\\\repo\\\\.claude\\\\skills\\\\query-db\n\n# Query DB Skill\n\nUse this skill to query Oracle.'
      },
      { type: 'text', text: '保留这条用户消息' }
    ]

    expect(getUserSidebarContent(content)).toEqual([{ type: 'text', text: '保留这条用户消息' }])
    expect(getUserPreviewText(content)).toBe('保留这条用户消息')
    expect(hasUserVisibleContent(content)).toBe(true)
  })

  it('strips leading skill json payloads from string content', () => {
    const content = `<current_datetime>2026-04-23T11:44:10.080+12:00</current_datetime>

[
  {
    "type": "text",
    "text": "Base directory for this skill: D:\\\\git\\\\repo\\\\.claude\\\\skills\\\\query-db\\n\\n# Query DB Skill\\n\\nUse this skill to query Oracle."
  }
]
我们把这个消息类型错当成用户消息了。`

    const extracted = extractLeadingSkillPayload(content)

    expect(extracted.remainderText).toBe('我们把这个消息类型错当成用户消息了。')
    expect(extracted.skillText).toContain('Base directory for this skill:')
    expect(extracted.skillText).toContain('Query DB Skill')
    expect(extracted.cleanedText).toContain('"type": "text"')
    expect(getUserPreviewText(content)).toBe('我们把这个消息类型错当成用户消息了。')
  })

  it('returns a placeholder for empty thinking messages', () => {
    expect(extractPlainText({ type: 'thinking', thinking: '' })).toBe('thinking...')
  })

  it('extracts nested subagent result text from toolUseResult payloads', () => {
    const content = {
      type: 'agent_result',
      toolUseResult: {
        status: 'completed',
        agentType: 'Explore',
        content: [
          {
            type: 'text',
            text: '这是子 agent 的结果正文。'
          }
        ]
      },
      content: [
        {
          type: 'tool_result',
          content: [
            {
              type: 'text',
              text: '外层包装内容'
            }
          ]
        }
      ]
    }

    expect(extractPlainText(content)).toBe('这是子 agent 的结果正文。')
  })
})
