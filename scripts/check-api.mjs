import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const port = 8797
const database = `server/data/check-${process.pid}.db`
const child = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, API_PORT: String(port), SOCIAL_COSMOS_DB: database },
  stdio: ['ignore', 'pipe', 'inherit'],
})

try {
  const base = `http://127.0.0.1:${port}/api`
  let health
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      health = await fetch(`${base}/health`).then((response) => response.json())
      break
    } catch {
      await delay(200)
    }
  }
  if (!health) throw new Error('API did not start within 6 seconds.')
  if (health.status !== 'ok') throw new Error('Health check failed.')

  const signInResponse = await fetch(`${base}/auth/signin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'demo@socialcosmos.local', password: 'Cosmos2026!' }),
  })
  if (!signInResponse.ok) throw new Error(`Sign-in failed with ${signInResponse.status}.`)
  const signIn = await signInResponse.json()
  if (!signIn.selfPlanet || signIn.friendPlanets.length < 5 || signIn.relationships.length < 5) throw new Error('Seeded cosmos is incomplete.')

  const analysisResponse = await fetch(`${base}/memories/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${signIn.session.token}` },
    body: JSON.stringify({ sourceType: 'text', rawText: 'Maya and I talked late into the night about our next trip.' }),
  })
  if (!analysisResponse.ok) throw new Error(`Memory analysis failed with ${analysisResponse.status}.`)
  const memory = await analysisResponse.json()
  if (!memory.people?.[0]?.relationType || !memory.summary) throw new Error('Memory analysis shape is incomplete.')
  console.log(JSON.stringify({ health, user: signIn.profile.email, planets: signIn.friendPlanets.length + 1, relationships: signIn.relationships.length, analysisProvider: memory.analysisProvider }, null, 2))
} finally {
  child.kill()
  await delay(200)
  const { rm } = await import('node:fs/promises')
  await rm(database, { force: true })
  await rm(`${database}-shm`, { force: true })
  await rm(`${database}-wal`, { force: true })
}
