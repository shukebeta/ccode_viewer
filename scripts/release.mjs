#!/usr/bin/env node
/**
 * Release script: bumps version across all manifests, commits, tags, and pushes.
 * Usage: node scripts/release.mjs <version>  (e.g. 0.9.0)
 */

import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/release.mjs <version>  (e.g. 0.9.0)')
  process.exit(1)
}

const tag = `v${version}`

function run(cmd) {
  return execSync(cmd, { cwd: root, stdio: 'inherit' })
}

function bumpJson(relPath) {
  const abs = resolve(root, relPath)
  const obj = JSON.parse(readFileSync(abs, 'utf8'))
  obj.version = version
  writeFileSync(abs, JSON.stringify(obj, null, 2) + '\n')
  console.log(`  bumped ${relPath}`)
}

function bumpCargo(relPath) {
  const abs = resolve(root, relPath)
  let src = readFileSync(abs, 'utf8')
  // Only replace the first `version = "..."` (the [package] section)
  src = src.replace(/^(version\s*=\s*)"[^"]*"/m, `$1"${version}"`)
  writeFileSync(abs, src)
  console.log(`  bumped ${relPath}`)
}

console.log(`\nReleasing ${tag}...\n`)

// 1. Bump versions
bumpJson('package.json')
bumpJson('viewer/package.json')
bumpJson('server/package.json')
bumpCargo('src-tauri/Cargo.toml')

// 2. Commit
run(`git add package.json viewer/package.json server/package.json src-tauri/Cargo.toml`)
run(`git commit -m "chore: release ${tag}"`)

// 3. Re-tag (delete old if exists)
try {
  execSync(`git tag -d ${tag}`, { cwd: root, stdio: 'pipe' })
  console.log(`  deleted local tag ${tag}`)
} catch { /* didn't exist */ }

try {
  execSync(`git push origin :refs/tags/${tag}`, { cwd: root, stdio: 'pipe' })
  console.log(`  deleted remote tag ${tag}`)
} catch { /* didn't exist */ }

run(`git tag ${tag}`)

// 4. Push
run(`git push origin master ${tag}`)

console.log(`\nDone. ${tag} is live.`)
