import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Script to generate a secure auth secret and write it to .env
// Usage: bun run scripts/generate-auth-secret.ts [--force]
// Or via package.json script: bun run gen:auth-secret [--force]

const root = process.cwd()
const envPath = join(root, '.env')
const envExamplePath = join(root, '.env.example')
const force = process.argv.includes('--force')

function generateSecret() {
  return randomBytes(32).toString('base64url') // ~256 bits entropy
}

function ensureEnvFile() {
  if (!existsSync(envPath)) {
    if (existsSync(envExamplePath)) {
      copyFileSync(envExamplePath, envPath)
      console.log('Created .env from .env.example')
    } else {
      writeFileSync(envPath, '')
      console.log('Created empty .env')
    }
  }
}

function updateEnv() {
  ensureEnvFile()
  const secret = generateSecret()
  const raw = readFileSync(envPath, 'utf8')
  const lines = raw.split(/\r?\n/)
  const key = 'BETTER_AUTH_SECRET'
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`))
  if (idx !== -1) {
    const currentValue = lines[idx].slice(key.length + 1).trim()
    if (!force && currentValue && currentValue !== 'secret-goes-here') {
      console.log(
        `${key} already set. Use --force to overwrite. Current length: ${currentValue.length}`,
      )
      return
    }
    lines[idx] = `${key}=${secret}`
  } else {
    lines.push(`${key}=${secret}`)
  }
  writeFileSync(envPath, lines.join('\n'))
  console.log(`Updated ${key} in .env (length: ${secret.length})`)
}

updateEnv()
