import { describe, it, expect } from 'vitest'
import { readHash, writeHash } from '../urlHash.js'

function makeEnv(initialHash = '', pathname = '/', search = '') {
  const calls = []
  const env = {
    location: { hash: initialHash, pathname, search },
    history: {
      replaceState(_state, _title, url) {
        calls.push(url)
        if (url.startsWith('#')) {
          env.location.hash = url
        } else {
          env.location.hash = ''
        }
      }
    },
    _calls: calls
  }
  return env
}

describe('readHash', () => {
  it('returns null for empty hash', () => {
    expect(readHash(makeEnv(''))).toBe(null)
    expect(readHash(makeEnv('#'))).toBe(null)
  })

  it('parses project and session', () => {
    const env = makeEnv('#project=abc&session=xyz&source=claudecode')
    expect(readHash(env)).toEqual({
      project: 'abc',
      session: 'xyz',
      source: 'claudecode'
    })
  })

  it('handles missing fields', () => {
    const env = makeEnv('#project=abc')
    expect(readHash(env)).toEqual({ project: 'abc', session: null, source: null })
  })

  it('decodes special characters', () => {
    const env = makeEnv('#project=' + encodeURIComponent('D--git-my/project') + '&session=' + encodeURIComponent('agent-1204ee53'))
    expect(readHash(env)).toEqual({
      project: 'D--git-my/project',
      session: 'agent-1204ee53',
      source: null
    })
  })

  it('returns null on malformed encoding', () => {
    const env = makeEnv('#project=%E0%A4%A')
    expect(readHash(env)).toBe(null)
  })

  it('returns null when no recognized fields', () => {
    const env = makeEnv('#foo=bar')
    expect(readHash(env)).toBe(null)
  })
})

describe('writeHash', () => {
  it('writes project, session, source', () => {
    const env = makeEnv()
    writeHash({ project: 'abc', session: 'xyz', source: 'claudecode' }, env)
    expect(env._calls[0]).toBe('#project=abc&session=xyz&source=claudecode')
  })

  it('encodes special characters', () => {
    const env = makeEnv()
    writeHash({ project: 'D--git-my/project', session: 'agent-1' }, env)
    expect(env._calls[0]).toBe('#project=D--git-my%2Fproject&session=agent-1')
  })

  it('round-trips through readHash', () => {
    const env = makeEnv()
    const state = { project: 'p1', session: 's1', source: 'codex' }
    writeHash(state, env)
    expect(readHash(env)).toEqual(state)
  })

  it('clears hash to pathname+search when empty', () => {
    const env = makeEnv('#project=abc', '/app', '?q=1')
    writeHash({}, env)
    expect(env._calls[0]).toBe('/app?q=1')
  })

  it('skips falsy fields', () => {
    const env = makeEnv()
    writeHash({ project: 'abc', session: null, source: undefined }, env)
    expect(env._calls[0]).toBe('#project=abc')
  })
})
