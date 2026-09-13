import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

// Read-only checks: this script never regenerates evidence to make a check pass.
const root = path.resolve(import.meta.dirname, '..')
process.chdir(root)
const people = ['chandler', 'joey', 'monica', 'phoebe', 'rachel', 'ross']
const fixtureFiles = (await readdir('public/demo-data')).filter(p => p.endsWith('.json')).sort()
assert.deepEqual(fixtureFiles, people.map(p => `${p}.json`))
for (const person of people) {
  const fixture = JSON.parse(await readFile(`public/demo-data/${person}.json`, 'utf8'))
  const { profile, session, friendPlanets } = fixture.cosmos
  assert.equal(profile.id, `friends-${person}`)
  assert.equal(profile.email, '')
  assert.equal(session.token, `public-fictional-demo-${person}`)
  assert.deepEqual(friendPlanets.map(p => p.ownerId).sort(), people.filter(p => p !== person).map(p => `friends-${p}`))
}

const manifest = JSON.parse(await readFile('docs/evidence/assets.json', 'utf8'))
async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const groups = await Promise.all(entries.map(entry => {
    const p = `${directory}/${entry.name}`
    return entry.isDirectory() ? filesUnder(p) : [p]
  }))
  return groups.flat().sort()
}
const media = (await filesUnder('public')).filter(p => /\.(jpg|jpeg|png|webp|glb|mp4)$/i.test(p))
assert.deepEqual(manifest.assets.map(a => a.path).sort(), media, 'Manifest must cover every checked-in public media file')
for (const asset of manifest.assets) {
  const bytes = await readFile(asset.path)
  assert.equal(bytes.length, asset.bytes, `Size mismatch: ${asset.path}`)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, `Hash mismatch: ${asset.path}`)
}

// Historical reference markdown deliberately retains its original broken links.
const docs = ['README.md', 'ATTRIBUTION.md', 'CONTRIBUTING.md', 'backend/README.md',
  ...(await filesUnder('docs')).filter(p => p.endsWith('.md') && !p.startsWith('docs/reference/'))]
let links = 0
for (const document of docs) {
  const content = await readFile(document, 'utf8')
  for (const match of content.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    const href = match[1]
    if (/^(https?:|mailto:|#)/.test(href)) continue
    const target = decodeURIComponent(href.split('#')[0])
    assert(await stat(path.resolve(path.dirname(document), target)).catch(() => null), `Broken local link in ${document}: ${href}`)
    links++
  }
}
console.log(`PASS: six fictional fixtures, ${media.length} media hashes, and ${links} local documentation links across ${docs.length} documents.`)
