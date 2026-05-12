import { describe, expect, it } from 'vitest'
import path from 'path'
import { fileURLToPath } from 'url'

const launcherModule = await import('../launcher.js')
const { resolvePublicDir } = launcherModule.resolvePublicDir ? launcherModule : launcherModule.default

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const localPublicDir = path.resolve(__dirname, '..', 'public')
const viewerDistDir = path.resolve(__dirname, '..', '..', 'viewer', 'dist')
const localIndexPath = path.join(localPublicDir, 'index.html')
const viewerIndexPath = path.join(viewerDistDir, 'index.html')

describe('resolvePublicDir', () => {
  it('uses CCODE_VIEWER_PUBLIC_DIR before checking default locations', () => {
    const customPublicDir = 'C:\\custom\\rewind\\public'
    const fileExists = () => {
      throw new Error('fileExists should not be called when env override is present')
    }

    expect(resolvePublicDir({
      env: { CCODE_VIEWER_PUBLIC_DIR: customPublicDir },
      fileExists
    })).toBe(customPublicDir)
  })

  it('prefers packaged assets in server/public when both builds exist', () => {
    const fileExists = (filePath) => {
      return filePath === localIndexPath || filePath === viewerIndexPath
    }

    expect(resolvePublicDir({ env: {}, fileExists })).toBe(localPublicDir)
  })

  it('falls back to viewer/dist when packaged assets are missing', () => {
    const fileExists = (filePath) => filePath === viewerIndexPath

    expect(resolvePublicDir({ env: {}, fileExists })).toBe(viewerDistDir)
  })

  it('returns server/public as the final fallback when no build output exists', () => {
    const fileExists = () => false

    expect(resolvePublicDir({ env: {}, fileExists })).toBe(localPublicDir)
  })
})
