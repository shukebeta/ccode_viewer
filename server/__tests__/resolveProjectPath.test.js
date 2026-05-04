import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'path'

import { resolveProjectPath } from '../fsHelpers'

function clearResolverCache() {
  if (resolveProjectPath._cache) {
    resolveProjectPath._cache.clear()
  }
}

describe('resolveProjectPath', () => {
  beforeEach(() => {
    clearResolverCache()
  })

  it('handles empty input', () => {
    expect(resolveProjectPath('', path.posix, vi.fn().mockReturnValue(false))).toBe('/')
  })

  it('returns absolute paths unchanged', () => {
    expect(resolveProjectPath('/home/user/project')).toBe('/home/user/project')
  })

  describe('Unix path scenarios', () => {
    it('handles simple Unix paths with existing directories', () => {
      const exists = vi.fn((targetPath) => {
        const pathStr = String(targetPath)
        return pathStr === '/' ||
          pathStr === '/home' ||
          pathStr === '/home/davidwei' ||
          pathStr === '/home/davidwei/bin'
      })

      expect(resolveProjectPath('-home-davidwei-bin', path.posix, exists)).toBe('/home/davidwei/bin')
    })

    it('detects underscore directories', () => {
      const exists = vi.fn((targetPath) => {
        const pathStr = String(targetPath)
        return pathStr === '/' ||
          pathStr === '/home' ||
          pathStr === '/home/davidwei' ||
          pathStr === '/home/davidwei/AndroidStudioProjects' ||
          pathStr === '/home/davidwei/AndroidStudioProjects/happy_notes'
      })

      expect(resolveProjectPath('-home-davidwei-AndroidStudioProjects-happy-notes', path.posix, exists))
        .toBe('/home/davidwei/AndroidStudioProjects/happy_notes')
    })

    it('falls back to slash separation when directories do not exist', () => {
      expect(resolveProjectPath(
        '-home-someuser-unknown-project',
        path.posix,
        vi.fn().mockReturnValue(false)
      )).toBe('/home/someuser/unknown/project')
    })

    it('preserves existing hyphen directories', () => {
      const exists = vi.fn((targetPath) => {
        const pathStr = String(targetPath)
        return pathStr === '/' ||
          pathStr === '/home' ||
          pathStr === '/home/davidwei' ||
          pathStr === '/home/davidwei/AndroidStudioProjects' ||
          pathStr === '/home/davidwei/AndroidStudioProjects/happy-notes'
      })

      expect(resolveProjectPath('-home-davidwei-AndroidStudioProjects-happy-notes', path.posix, exists))
        .toBe('/home/davidwei/AndroidStudioProjects/happy-notes')
    })

    it('prefers longer hyphenated matches over earlier prefix directories', () => {
      const exists = vi.fn((targetPath) => {
        const pathStr = String(targetPath)
        return pathStr === '/' ||
          pathStr === '/home' ||
          pathStr === '/home/davidw' ||
          pathStr === '/home/davidw/Projects' ||
          pathStr === '/home/davidw/Projects/gridai' ||
          pathStr === '/home/davidw/Projects/gridai-auto-job'
      })

      expect(resolveProjectPath('-home-davidw-Projects-gridai-auto-job', path.posix, exists))
        .toBe('/home/davidw/Projects/gridai-auto-job')
    })
  })

  describe('Windows path scenarios', () => {
    it('handles basic Windows paths without file existence checking', () => {
      expect(resolveProjectPath(
        'C--Users-David-Wei-bin',
        path.win32,
        vi.fn().mockReturnValue(false)
      )).toBe('C:\\Users\\David\\Wei\\bin')
    })

    it('prefers dotted directories when they exist', () => {
      const exists = vi.fn((targetPath) => {
        const pathStr = String(targetPath)
        return pathStr === 'C:\\' ||
          pathStr === 'C:\\Users' ||
          pathStr === 'C:\\Users\\David.Wei' ||
          pathStr === 'C:\\Users\\David.Wei\\bin'
      })

      expect(resolveProjectPath('C--Users-David-Wei-bin', path.win32, exists)).toBe('C:\\Users\\David.Wei\\bin')
    })

    it('prefers nested directories when that structure exists', () => {
      const exists = vi.fn((targetPath) => {
        const pathStr = String(targetPath)
        return pathStr === 'C:\\' ||
          pathStr === 'C:\\Users' ||
          pathStr === 'C:\\Users\\David' ||
          pathStr === 'C:\\Users\\David\\Wei' ||
          pathStr === 'C:\\Users\\David\\Wei\\bin'
      })

      expect(resolveProjectPath('C--Users-David-Wei-bin', path.win32, exists)).toBe('C:\\Users\\David\\Wei\\bin')
    })

    it('handles dotted directory names deeper in the path', () => {
      const exists = vi.fn((targetPath) => {
        const pathStr = String(targetPath)
        return pathStr === 'C:\\' ||
          pathStr === 'C:\\Users' ||
          pathStr === 'C:\\Users\\David.Wei' ||
          pathStr === 'C:\\Users\\David.Wei\\RiderProjects' ||
          pathStr === 'C:\\Users\\David.Wei\\RiderProjects\\HappyNotes.Api'
      })

      expect(resolveProjectPath('C--Users-David-Wei-RiderProjects-HappyNotes-Api', path.win32, exists))
        .toBe('C:\\Users\\David.Wei\\RiderProjects\\HappyNotes.Api')
    })

    it('handles lookahead across multiple segments on another drive', () => {
      const exists = vi.fn((targetPath) => {
        const pathStr = String(targetPath)
        return pathStr === 'D:\\' ||
          pathStr === 'D:\\git' ||
          pathStr === 'D:\\git\\apollo' ||
          pathStr === 'D:\\git\\apollo\\quotes-api'
      })

      expect(resolveProjectPath('D--git-apollo-quotes-api', path.win32, exists)).toBe('D:\\git\\apollo\\quotes-api')
    })

    it('uses cached results for repeated calls', () => {
      const exists = vi.fn().mockReturnValue(false)

      const first = resolveProjectPath('C--Users-test', path.win32, exists)
      const second = resolveProjectPath('C--Users-test', path.win32, exists)

      expect(first).toBe('C:\\Users\\test')
      expect(second).toBe(first)
      expect(exists).toHaveBeenCalled()
    })

    it('preserves existing hyphenated directories', () => {
      const exists = vi.fn((targetPath) => {
        const pathStr = String(targetPath)
        return pathStr === 'C:\\' ||
          pathStr === 'C:\\Users' ||
          pathStr === 'C:\\Users\\David-Wei' ||
          pathStr === 'C:\\Users\\David-Wei\\bin'
      })

      expect(resolveProjectPath('C--Users-David-Wei-bin', path.win32, exists)).toBe('C:\\Users\\David-Wei\\bin')
    })
  })
})
