import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

const projects = [
  { name: 'root', dir: repoRoot },
  { name: 'server', dir: path.join(repoRoot, 'server') },
  { name: 'viewer', dir: path.join(repoRoot, 'viewer') }
]

const installStampName = '.dev-install-stamp.json'

function fileMtime(filePath) {
  return existsSync(filePath) ? statSync(filePath).mtimeMs : 0
}

function getInstallMarker(projectDir) {
  const marker = path.join(projectDir, 'node_modules', '.modules.yaml')
  return existsSync(marker) ? marker : null
}

function getInstallStampPath(projectDir) {
  return path.join(projectDir, 'node_modules', installStampName)
}

function getDependencyState(projectDir) {
  return {
    packageJsonMtime: fileMtime(path.join(projectDir, 'package.json')),
    lockfileMtime: fileMtime(path.join(projectDir, 'pnpm-lock.yaml'))
  }
}

function readInstallStamp(projectDir) {
  const stampPath = getInstallStampPath(projectDir)
  if (!existsSync(stampPath)) return null

  try {
    return JSON.parse(readFileSync(stampPath, 'utf8'))
  } catch {
    return null
  }
}

function needsInstall(projectDir) {
  const marker = getInstallMarker(projectDir)
  if (!marker) return true

  const currentState = getDependencyState(projectDir)
  const stamp = readInstallStamp(projectDir)
  if (stamp) {
    return (
      stamp.packageJsonMtime !== currentState.packageJsonMtime ||
      stamp.lockfileMtime !== currentState.lockfileMtime
    )
  }

  const markerTime = fileMtime(marker)
  return Math.max(currentState.packageJsonMtime, currentState.lockfileMtime) > markerTime
}

function writeInstallStamp(projectDir) {
  writeFileSync(
    getInstallStampPath(projectDir),
    JSON.stringify(getDependencyState(projectDir))
  )
}

function runPnpmInstall(project) {
  console.log(`[predev] Installing ${project.name} dependencies...`)

  const result = spawnSync(
    pnpmCommand,
    ['install', '--frozen-lockfile'],
    {
      cwd: project.dir,
      stdio: 'inherit',
      shell: process.platform === 'win32'
    }
  )

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`pnpm install failed for ${project.name} with exit code ${result.status}`)
  }

  writeInstallStamp(project.dir)
}

for (const project of projects) {
  if (needsInstall(project.dir)) {
    runPnpmInstall(project)
    continue
  }

  console.log(`[predev] ${project.name} dependencies are up to date.`)
}
