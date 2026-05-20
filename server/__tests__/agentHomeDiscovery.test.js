import { afterEach, describe, expect, it } from 'vitest'

import {
  discoverAgentHomes,
  clearAgentHomeDiscoveryCache,
  DEFAULT_DISCOVERY_CACHE_TTL_MS
} from '../discovery/agentHomeDiscovery'

afterEach(() => {
  clearAgentHomeDiscoveryCache()
})

function makeDirent(name, { isDirectory = true } = {}) {
  return {
    name,
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
    isSymbolicLink: () => false
  }
}

function makeStubFs({ entries = {}, realpath = {}, lstat = {} } = {}) {
  const readdirCalls = []
  return {
    readdirCalls,
    async readdir(dir) {
      readdirCalls.push(dir)
      if (entries[dir]) return entries[dir]
      const error = new Error(`ENOENT: ${dir}`)
      error.code = 'ENOENT'
      throw error
    },
    async realpath(p) {
      if (Object.prototype.hasOwnProperty.call(realpath, p)) return realpath[p]
      return p
    },
    async lstat(p) {
      if (Object.prototype.hasOwnProperty.call(lstat, p)) return lstat[p]
      return { isSymbolicLink: () => false }
    }
  }
}

describe('discoverAgentHomes', () => {
  const HOME = '/home/test'
  const PROJECTS_DEFAULT = `${HOME}/.claude/projects`
  const PROJECTS_DEV = `${HOME}/.claude-dev/projects`
  const PROJECTS_W = `${HOME}/.claudew/projects`
  const PROJECTS_W_PLAN = `${HOME}/.claudew-plan/projects`

  it('discovers all .claude* homes whose subdir exists', async () => {
    const fsModule = makeStubFs({
      entries: {
        [HOME]: [
          makeDirent('.claude'),
          makeDirent('.claude-dev'),
          makeDirent('.claudew'),
          makeDirent('.claudew-plan'),
          makeDirent('.codex'),
          makeDirent('Projects')
        ]
      },
      realpath: {
        [PROJECTS_DEFAULT]: PROJECTS_DEFAULT,
        [PROJECTS_DEV]: PROJECTS_DEV,
        [PROJECTS_W]: PROJECTS_W,
        [PROJECTS_W_PLAN]: PROJECTS_W_PLAN
      },
      lstat: {
        [PROJECTS_DEFAULT]: { isSymbolicLink: () => false },
        [PROJECTS_DEV]: { isSymbolicLink: () => false },
        [PROJECTS_W]: { isSymbolicLink: () => false },
        [PROJECTS_W_PLAN]: { isSymbolicLink: () => false }
      }
    })

    const homes = await discoverAgentHomes({
      kind: 'claudecode',
      env: {},
      homedir: HOME,
      fsModule,
      cacheTtlMs: 0
    })

    expect(homes.map((h) => h.homeName)).toEqual([
      '.claude',
      '.claude-dev',
      '.claudew',
      '.claudew-plan'
    ])
    expect(homes[0]).toMatchObject({
      kind: 'claudecode',
      homeDir: `${HOME}/.claude`,
      sessionDir: PROJECTS_DEFAULT,
      isCanonical: true,
      isSymlink: false
    })
    expect(homes[3]).toMatchObject({
      homeName: '.claudew-plan',
      sessionDir: PROJECTS_W_PLAN,
      isCanonical: false
    })
  })

  it('dedupes by realpath, canonical home wins', async () => {
    const fsModule = makeStubFs({
      entries: {
        [HOME]: [
          makeDirent('.claude'),
          makeDirent('.claude-dev'),
          makeDirent('.claudew-plan')
        ]
      },
      realpath: {
        [PROJECTS_DEFAULT]: PROJECTS_DEFAULT,
        [PROJECTS_DEV]: PROJECTS_DEFAULT,
        [PROJECTS_W_PLAN]: PROJECTS_DEFAULT
      },
      lstat: {
        [PROJECTS_DEFAULT]: { isSymbolicLink: () => false },
        [PROJECTS_DEV]: { isSymbolicLink: () => true },
        [PROJECTS_W_PLAN]: { isSymbolicLink: () => true }
      }
    })

    const homes = await discoverAgentHomes({
      kind: 'claudecode',
      env: {},
      homedir: HOME,
      fsModule,
      cacheTtlMs: 0
    })

    expect(homes).toHaveLength(1)
    expect(homes[0]).toMatchObject({
      homeName: '.claude',
      isCanonical: true,
      realPath: PROJECTS_DEFAULT
    })
  })

  it('reflects isSymlink from lstat on sessionDir', async () => {
    const fsModule = makeStubFs({
      entries: {
        [HOME]: [makeDirent('.claudew-plan')]
      },
      realpath: { [PROJECTS_W_PLAN]: PROJECTS_DEFAULT },
      lstat: { [PROJECTS_W_PLAN]: { isSymbolicLink: () => true } }
    })

    const [home] = await discoverAgentHomes({
      kind: 'claudecode',
      env: {},
      homedir: HOME,
      fsModule,
      cacheTtlMs: 0
    })

    expect(home.isSymlink).toBe(true)
    expect(home.realPath).toBe(PROJECTS_DEFAULT)
  })

  it('returns a single <override> entry when CLAUDE_PROJECTS_PATH is set and skips $HOME scan', async () => {
    const fsModule = makeStubFs({
      lstat: { '/custom/path': { isSymbolicLink: () => false } },
      realpath: { '/custom/path': '/custom/path' }
    })

    const homes = await discoverAgentHomes({
      kind: 'claudecode',
      env: { CLAUDE_PROJECTS_PATH: '/custom/path' },
      homedir: HOME,
      fsModule,
      cacheTtlMs: 0
    })

    expect(homes).toEqual([
      {
        kind: 'claudecode',
        homeName: '<override>',
        homeDir: '/custom',
        sessionDir: '/custom/path',
        realPath: '/custom/path',
        isSymlink: false,
        isCanonical: false
      }
    ])
    expect(fsModule.readdirCalls).toEqual([])
  })

  it('caches discovery results within the TTL window', async () => {
    const fsModule = makeStubFs({ entries: { [HOME]: [] } })

    const first = await discoverAgentHomes({
      kind: 'claudecode',
      env: {},
      homedir: HOME,
      fsModule,
      cacheTtlMs: 5000,
      now: 1000
    })
    const second = await discoverAgentHomes({
      kind: 'claudecode',
      env: {},
      homedir: HOME,
      fsModule,
      cacheTtlMs: 5000,
      now: 2000
    })
    const third = await discoverAgentHomes({
      kind: 'claudecode',
      env: {},
      homedir: HOME,
      fsModule,
      cacheTtlMs: 5000,
      now: 7001
    })

    expect(first).toEqual([])
    expect(second).toBe(first)
    expect(third).toEqual([])
    expect(third).not.toBe(first)
    expect(fsModule.readdirCalls).toEqual([HOME, HOME])
  })

  it('uses kind-specific subdir for codex (sessions/) and gcopilot (session-state/)', async () => {
    const fsModule = makeStubFs({
      entries: {
        [HOME]: [makeDirent('.codex'), makeDirent('.codex-plan')]
      },
      realpath: {
        [`${HOME}/.codex/sessions`]: `${HOME}/.codex/sessions`,
        [`${HOME}/.codex-plan/sessions`]: `${HOME}/.codex-plan/sessions`
      },
      lstat: {
        [`${HOME}/.codex/sessions`]: { isSymbolicLink: () => false },
        [`${HOME}/.codex-plan/sessions`]: { isSymbolicLink: () => false }
      }
    })

    const homes = await discoverAgentHomes({
      kind: 'codex',
      env: {},
      homedir: HOME,
      fsModule,
      cacheTtlMs: 0
    })

    expect(homes.map((h) => h.sessionDir)).toEqual([
      `${HOME}/.codex/sessions`,
      `${HOME}/.codex-plan/sessions`
    ])
  })

  it('exposes a positive default cache TTL', () => {
    expect(DEFAULT_DISCOVERY_CACHE_TTL_MS).toBeGreaterThan(0)
  })
})
