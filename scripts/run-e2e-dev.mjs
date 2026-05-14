import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const fixturesDir = path.join(rootDir, 'e2e', 'fixtures')

const env = {
  ...process.env,
  CLAUDE_PROJECTS_PATH: path.join(fixturesDir, 'claude-projects'),
  COPILOT_SESSION_PATH: path.join(fixturesDir, 'copilot-session-state'),
  CODEX_SESSIONS_PATH: path.join(fixturesDir, 'codex-sessions'),
  PORT: '4173',
  VITE_PORT: '4174',
  VITE_API_PROXY_TARGET: 'http://127.0.0.1:4173'
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const child = spawn(npmCommand, ['run', 'dev'], {
  cwd: rootDir,
  env,
  stdio: 'inherit'
})

const forwardSignal = (signal) => {
  if (!child.killed) child.kill(signal)
}

process.on('SIGINT', forwardSignal)
process.on('SIGTERM', forwardSignal)

child.on('exit', (code, signal) => {
  process.off('SIGINT', forwardSignal)
  process.off('SIGTERM', forwardSignal)

  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
