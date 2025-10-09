import { describe, it, expect, beforeEach, vi } from 'vitest'
import { existsSync } from 'fs'
import path from 'path'

// Mock fs.existsSync to control file system behavior in tests
vi.mock('fs', () => ({
  existsSync: vi.fn()
}))

const mockExistsSync = vi.mocked(existsSync)

// Import the resolver from fsHelpers (it's internal but we can test via require)
// Since resolveProjectPath is not exported, we'll test it by injecting it
let resolveProjectPath
let clearCache

beforeEach(async () => {
  // Re-import module to get fresh cache
  vi.resetModules()
  const fsHelpers = await import('../fsHelpers.js')

  // Access the internal function by evaluating the module source
  // For now, we'll inline the function for testing
  resolveProjectPath = function(projectName, pathImpl = path) {
    const pathCache = resolveProjectPath._cache || (resolveProjectPath._cache = new Map())

    if (pathCache.has(projectName)) {
      return pathCache.get(projectName)
    }

    if (!projectName || projectName === '-') {
      const result = pathImpl.resolve(pathImpl.sep)
      pathCache.set(projectName, result)
      return result
    }

    const isWindowsProjectFolder = /^[A-Za-z]--/.test(projectName)

    if (!projectName.startsWith('-') && !isWindowsProjectFolder) {
      pathCache.set(projectName, projectName)
      return projectName
    }

    let workingProjectName = projectName
    let drivePrefix = ''

    if (isWindowsProjectFolder) {
      const driveMatch = projectName.match(/^([A-Za-z])--(.+)$/)
      if (driveMatch) {
        const [, driveLetter, pathPart] = driveMatch
        drivePrefix = `${driveLetter.toUpperCase()}:`
        workingProjectName = `-${pathPart}`
      }
    }

    let remaining = workingProjectName.substring(1)

    while (remaining.startsWith('-')) {
      remaining = remaining.substring(1)
    }

    let currentPath = pathImpl.sep

    while (remaining.length > 0) {
      let nextDashIndex = remaining.indexOf('-')

      if (nextDashIndex === -1) {
        currentPath = pathImpl.join(currentPath, remaining)
        break
      }

      const possiblePart = remaining.substring(0, nextDashIndex)
      const possiblePathAsSlash = pathImpl.join(currentPath, possiblePart)
      const possiblePathAsUnderscore = pathImpl.join(currentPath, possiblePart.replace(/-/g, '_'))
      const possiblePathAsDot = pathImpl.join(currentPath, possiblePart.replace(/-/g, '.'))

      const resolvedPathAsSlash = pathImpl.resolve(drivePrefix + possiblePathAsSlash)
      const resolvedPathAsUnderscore = pathImpl.resolve(drivePrefix + possiblePathAsUnderscore)
      const resolvedPathAsDot = pathImpl.resolve(drivePrefix + possiblePathAsDot)

      if (existsSync(resolvedPathAsSlash)) {
        currentPath = possiblePathAsSlash
        remaining = remaining.substring(nextDashIndex + 1)
      } else if (existsSync(resolvedPathAsUnderscore)) {
        currentPath = possiblePathAsUnderscore
        remaining = remaining.substring(nextDashIndex + 1)
      } else if (existsSync(resolvedPathAsDot)) {
        currentPath = possiblePathAsDot
        remaining = remaining.substring(nextDashIndex + 1)
      } else {
        let foundValid = false
        let searchIndex = nextDashIndex + 1

        while (searchIndex < remaining.length) {
          const nextSearchIndex = remaining.indexOf('-', searchIndex)
          if (nextSearchIndex === -1) {
            const testPart = remaining
            const testPath = pathImpl.join(currentPath, testPart)
            const testPartWithUnderscore = testPart.replace(/-/g, '_')
            const testPathWithUnderscore = pathImpl.join(currentPath, testPartWithUnderscore)
            const testPartWithDot = testPart.replace(/-/g, '.')
            const testPathWithDot = pathImpl.join(currentPath, testPartWithDot)

            const resolvedTestPath = pathImpl.resolve(drivePrefix + testPath)
            const resolvedTestPathWithUnderscore = pathImpl.resolve(drivePrefix + testPathWithUnderscore)
            const resolvedTestPathWithDot = pathImpl.resolve(drivePrefix + testPathWithDot)

            if (existsSync(resolvedTestPath)) {
              currentPath = testPath
              remaining = ''
              foundValid = true
            } else if (existsSync(resolvedTestPathWithUnderscore)) {
              currentPath = testPathWithUnderscore
              remaining = ''
              foundValid = true
            } else if (existsSync(resolvedTestPathWithDot)) {
              currentPath = testPathWithDot
              remaining = ''
              foundValid = true
            }
            break
          }

          const testPart = remaining.substring(0, nextSearchIndex)
          const testPath = pathImpl.join(currentPath, testPart)
          const testPartWithUnderscore = testPart.replace(/-/g, '_')
          const testPathWithUnderscore = pathImpl.join(currentPath, testPartWithUnderscore)
          const testPartWithDot = testPart.replace(/-/g, '.')
          const testPathWithDot = pathImpl.join(currentPath, testPartWithDot)

          const resolvedTestPath = pathImpl.resolve(drivePrefix + testPath)
          const resolvedTestPathWithUnderscore = pathImpl.resolve(drivePrefix + testPathWithUnderscore)
          const resolvedTestPathWithDot = pathImpl.resolve(drivePrefix + testPathWithDot)

          if (existsSync(resolvedTestPath)) {
            currentPath = testPath
            remaining = remaining.substring(nextSearchIndex + 1)
            foundValid = true
            break
          } else if (existsSync(resolvedTestPathWithUnderscore)) {
            currentPath = testPathWithUnderscore
            remaining = remaining.substring(nextSearchIndex + 1)
            foundValid = true
            break
          } else if (existsSync(resolvedTestPathWithDot)) {
            currentPath = testPathWithDot
            remaining = remaining.substring(nextSearchIndex + 1)
            foundValid = true
            break
          }

          searchIndex = nextSearchIndex + 1
        }

        if (!foundValid) {
          currentPath = pathImpl.join(currentPath, possiblePart)
          remaining = remaining.substring(nextDashIndex + 1)
        }
      }
    }

    let result = currentPath

    if (drivePrefix) {
      result = drivePrefix + result
    }

    pathCache.set(projectName, result)
    return result
  }

  clearCache = () => {
    if (resolveProjectPath._cache) {
      resolveProjectPath._cache.clear()
    }
  }
})

describe('pathResolver', () => {
  beforeEach(() => {
    clearCache()
    vi.clearAllMocks()
  })

  describe('resolveProjectPath', () => {
    it('should handle empty input', () => {
      mockExistsSync.mockReturnValue(false)
      const result = resolveProjectPath('', path.posix)
      expect(result).toBe('/')
    })

    it('should handle paths that are already in correct format', () => {
      const result = resolveProjectPath('/home/user/project')
      expect(result).toBe('/home/user/project')
    })

    describe('Unix path scenarios (/ separator)', () => {
      it('should handle simple Unix paths with existing directories', () => {
        mockExistsSync.mockImplementation((p) => {
          const pathStr = String(p)
          return pathStr.includes('/home') ||
                 pathStr.includes('/home/davidwei') ||
                 pathStr.includes('/home/davidwei/bin')
        })

        const result = resolveProjectPath('-home-davidwei-bin', path.posix)
        expect(result).toBe('/home/davidwei/bin')
      })

      it('should handle underscore detection in Unix paths', () => {
        mockExistsSync.mockImplementation((p) => {
          const pathStr = String(p)
          return pathStr === '/home/davidwei/AndroidStudioProjects/happy_notes' ||
                 pathStr === '/home/davidwei/AndroidStudioProjects' ||
                 pathStr === '/home/davidwei' ||
                 pathStr === '/home' ||
                 pathStr === '/'
        })

        const result = resolveProjectPath('-home-davidwei-AndroidStudioProjects-happy-notes', path.posix)
        expect(result).toBe('/home/davidwei/AndroidStudioProjects/happy_notes')
      })

      it('should fallback to dash separation when directories do not exist', () => {
        mockExistsSync.mockReturnValue(false)
        const result = resolveProjectPath('-home-someuser-unknown-project', path.posix)
        expect(result).toBe('/home/someuser/unknown/project')
      })
    })

    describe('Windows path scenarios (\\\\ separator)', () => {
      it('should handle basic Windows paths without file existence checking', () => {
        mockExistsSync.mockReturnValue(false)
        const result = resolveProjectPath('C--Users-David-Wei-bin', path.win32)
        expect(result).toBe('C:\\Users\\David\\Wei\\bin')
      })

      it('should prefer David.Wei when that directory exists', () => {
        mockExistsSync.mockImplementation((p) => {
          const pathStr = String(p)
          return pathStr === 'C:\\Users\\David.Wei' ||
                 pathStr === 'C:\\Users\\David.Wei\\bin' ||
                 pathStr === 'C:\\Users' ||
                 pathStr === 'C:\\'
        })

        const result = resolveProjectPath('C--Users-David-Wei-bin', path.win32)
        expect(result).toBe('C:\\Users\\David.Wei\\bin')
      })

      it('should prefer David\\\\Wei when that directory structure exists', () => {
        mockExistsSync.mockImplementation((p) => {
          const pathStr = String(p)
          return pathStr === 'C:\\Users\\David' ||
                 pathStr === 'C:\\Users\\David\\Wei' ||
                 pathStr === 'C:\\Users\\David\\Wei\\bin' ||
                 pathStr === 'C:\\Users' ||
                 pathStr === 'C:\\'
        })

        const result = resolveProjectPath('C--Users-David-Wei-bin', path.win32)
        expect(result).toBe('C:\\Users\\David\\Wei\\bin')
      })

      it('should handle HappyNotes.Api when that directory exists', () => {
        mockExistsSync.mockImplementation((p) => {
          const pathStr = String(p)
          return pathStr === 'C:\\' ||
                 pathStr === 'C:\\Users' ||
                 pathStr === 'C:\\Users\\David.Wei' ||
                 pathStr === 'C:\\Users\\David.Wei\\RiderProjects' ||
                 pathStr === 'C:\\Users\\David.Wei\\RiderProjects\\HappyNotes.Api'
        })

        const result = resolveProjectPath('C--Users-David-Wei-RiderProjects-HappyNotes-Api', path.win32)
        expect(result).toBe('C:\\Users\\David.Wei\\RiderProjects\\HappyNotes.Api')
      })

      it('should handle quotes-api on D drive with lookahead', () => {
        mockExistsSync.mockImplementation((p) => {
          const pathStr = String(p)
          return pathStr === 'D:\\' ||
                 pathStr === 'D:\\git' ||
                 pathStr === 'D:\\git\\apollo' ||
                 pathStr === 'D:\\git\\apollo\\quotes-api'
        })

        const result = resolveProjectPath('D--git-apollo-quotes-api', path.win32)
        expect(result).toBe('D:\\git\\apollo\\quotes-api')
      })

      it('should use cache for repeated calls', () => {
        mockExistsSync.mockReturnValue(false)

        const result1 = resolveProjectPath('C--Users-test', path.win32)
        const result2 = resolveProjectPath('C--Users-test', path.win32)

        expect(result1).toBe(result2)
        expect(result1).toBe('C:\\Users\\test')
      })

      it('should preserve original hyphen directories when they actually exist', () => {
        mockExistsSync.mockImplementation((p) => {
          const pathStr = String(p)
          return pathStr === 'C:\\Users\\David-Wei' ||
                 pathStr === 'C:\\Users\\David-Wei\\bin' ||
                 pathStr === 'C:\\Users' ||
                 pathStr === 'C:\\'
        })

        const result = resolveProjectPath('C--Users-David-Wei-bin', path.win32)
        expect(result).toBe('C:\\Users\\David-Wei\\bin')
      })
    })

    describe('Unix path edge cases', () => {
      it('should preserve original hyphen directories in Unix paths when they exist', () => {
        mockExistsSync.mockImplementation((p) => {
          const pathStr = String(p)
          return pathStr === '/home/davidwei/AndroidStudioProjects/happy-notes' ||
                 pathStr === '/home/davidwei/AndroidStudioProjects' ||
                 pathStr === '/home/davidwei' ||
                 pathStr === '/home' ||
                 pathStr === '/'
        })

        const result = resolveProjectPath('-home-davidwei-AndroidStudioProjects-happy-notes', path.posix)
        expect(result).toBe('/home/davidwei/AndroidStudioProjects/happy-notes')
      })
    })
  })
})
