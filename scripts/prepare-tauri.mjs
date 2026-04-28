import { chmod, copyFile, cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const srcTauriDir = path.join(repoRoot, 'src-tauri')
const resourcesDir = path.join(srcTauriDir, 'resources')
const resourcesAppDir = path.join(resourcesDir, 'app')
const binariesDir = path.join(srcTauriDir, 'binaries')
const packageServerDir = path.join(resourcesAppDir, 'server')
const packagePublicDir = path.join(packageServerDir, 'public')
const buildInfoJsonPath = path.join(resourcesAppDir, 'BUILD-INFO.json')
const buildInfoTextPath = path.join(resourcesAppDir, 'BUILD-INFO.txt')
const sidecarBaseName = 'rewind-node'

function quoteArg(arg) {
  const str = String(arg)
  return /[\s"]/u.test(str) ? `"${str.replace(/"/g, '\\"')}"` : str
}

function run(command, args, options = {}) {
  const commandLine = [quoteArg(command), ...args.map(quoteArg)].join(' ')
  const result = spawnSync(commandLine, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
    ...options
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${commandLine} failed with exit code ${result.status}`)
  }

  return result
}

function getTargetTriple() {
  const result = spawnSync('rustc', ['--print', 'host-tuple'], {
    cwd: repoRoot,
    encoding: 'utf8'
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error('rustc --print host-tuple failed. Install Rust before building the Tauri desktop app.')
  }

  const triple = result.stdout.trim()
  if (!triple) {
    throw new Error('Could not determine Rust target triple for the Tauri sidecar binary.')
  }

  return triple
}

function shouldCopyServerPath(sourcePath) {
  const parts = sourcePath.split(path.sep)
  return !parts.includes('node_modules') && !parts.includes('__tests__') && !parts.includes('public')
}

function getBuildMetadata() {
  const buildId = `${(process.env.GITHUB_SHA || 'local').slice(0, 12)}-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')}`

  return {
    buildId,
    builtFrom: process.env.GITHUB_SHA || 'local-working-copy',
    generatedAt: new Date().toISOString(),
    productName: 'Rewind',
    description: 'Tauri desktop host with bundled Node sidecar and packaged app payload'
  }
}

function getBuildInfoText(build) {
  return [
    'Rewind — Navigate and explore your AI coding sessions',
    `Build ID: ${build.buildId}`,
    `Built from: ${build.builtFrom}`,
    `Generated at: ${build.generatedAt}`,
    '',
    'Launch behavior:',
    '- Bundles a native Tauri desktop shell with a platform-native Node sidecar',
    '- Copies the packaged app payload into the app-local data directory on first launch of a build',
    '- Starts the embedded Express server via server/launcher.js',
    '- Waits for the generated local URL and opens it inside the Tauri webview',
    '- Closing the desktop window shuts down the child Node process'
  ].join('\n')
}

async function removeExistingSidecars() {
  await mkdir(binariesDir, { recursive: true })
  const entries = await readdir(binariesDir, { withFileTypes: true })

  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(`${sidecarBaseName}-`))
    .map((entry) => rm(path.join(binariesDir, entry.name), { force: true })))
}

async function copyNodeSidecar() {
  const extension = process.platform === 'win32' ? '.exe' : ''
  const targetTriple = getTargetTriple()
  const destination = path.join(binariesDir, `${sidecarBaseName}-${targetTriple}${extension}`)

  await copyFile(process.execPath, destination)
  if (process.platform !== 'win32') {
    await chmod(destination, 0o755)
  }
}

async function preparePackagedApp(build) {
  await rm(resourcesAppDir, { recursive: true, force: true })
  await mkdir(packagePublicDir, { recursive: true })

  await cp(path.join(repoRoot, 'server'), packageServerDir, {
    recursive: true,
    filter: shouldCopyServerPath
  })
  await cp(path.join(repoRoot, 'shared'), path.join(resourcesAppDir, 'shared'), { recursive: true })

  await writeFile(buildInfoJsonPath, JSON.stringify(build, null, 2))
  await writeFile(buildInfoTextPath, getBuildInfoText(build))

  run('pnpm', [
    '--dir',
    packageServerDir,
    'install',
    '--prod',
    '--frozen-lockfile',
    '--config.node-linker=hoisted',
    '--config.package-import-method=copy'
  ])
  run('pnpm', [
    '--dir',
    path.join(repoRoot, 'viewer'),
    'exec',
    'vite',
    'build',
    '--outDir',
    packagePublicDir,
    '--emptyOutDir'
  ])
}

async function main() {
  const build = getBuildMetadata()

  await Promise.all([
    removeExistingSidecars(),
    preparePackagedApp(build)
  ])

  await copyNodeSidecar()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
