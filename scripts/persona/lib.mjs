import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const PERSONA_SCHEMA_VERSION = 1
export const PERSONA_PROMPT_VERSION = 'hk-cohort-v1'

export function assert(condition, message) {
  if (!condition) throw new Error(message)
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function seededRelationshipId(relationshipId, ownerUserId) {
  return `${relationshipId}-${ownerUserId}`
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function readJsonl(path) {
  const text = await readFile(path, 'utf8')
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(`${path}:${index + 1} is not valid JSON: ${error.message}`)
      }
    })
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export async function writeJsonl(path, values) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${values.map((value) => JSON.stringify(value)).join('\n')}\n`, 'utf8')
}

export function parseArgs(argv) {
  const args = new Map()
  const flags = new Set()
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const separator = item.indexOf('=')
    if (separator > 0) {
      args.set(item.slice(2, separator), item.slice(separator + 1))
      continue
    }
    const name = item.slice(2)
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      args.set(name, next)
      index += 1
    } else {
      flags.add(name)
    }
  }
  return {
    get: (name, fallback) => args.get(name) ?? fallback,
    has: (name) => flags.has(name) || args.has(name),
  }
}

function extractJson(content) {
  const trimmed = content.trim()
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  try {
    return JSON.parse(withoutFence)
  } catch {
    const start = withoutFence.indexOf('{')
    const end = withoutFence.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(withoutFence.slice(start, end + 1))
    throw new Error('Model response did not contain a JSON object')
  }
}

function completionUrl(apiBase) {
  const base = apiBase.replace(/\/$/, '')
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}

function modelContent(message) {
  if (typeof message?.content === 'string') return message.content
  if (Array.isArray(message?.content)) {
    return message.content
      .filter((part) => part?.type === 'text' || typeof part?.text === 'string')
      .map((part) => part.text || '')
      .join('')
  }
  return ''
}

export async function callJsonModel({ apiBase, apiKey, model, stage, system, input, temperature = 0.3, retries = 2 }) {
  const url = completionUrl(apiBase)
  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: JSON.stringify(input) },
          ],
        }),
        signal: AbortSignal.timeout(Number(process.env.PERSONA_TIMEOUT_MS || 180000)),
      })
      const responseText = await response.text()
      if (!response.ok) throw new Error(`${stage} request returned ${response.status}: ${responseText.slice(0, 400)}`)
      const body = JSON.parse(responseText)
      const content = modelContent(body.choices?.[0]?.message)
      assert(content, `${stage} response did not include message content`)
      return {
        data: extractJson(content),
        raw: content,
        requestId: response.headers.get('x-request-id') || body.id || null,
      }
    } catch (error) {
      lastError = error
      if (attempt === retries) break
      await new Promise((resolve) => setTimeout(resolve, 750 * (2 ** attempt)))
    }
  }
  throw lastError
}

export function modelConfig() {
  const apiBase = process.env.PERSONA_AI_BASE_URL
    || process.env.AGENT_AI_BASE_URL
    || process.env.OPENVIKING_AI_BASE_URL
  const apiKey = process.env.PERSONA_AI_API_KEY
    || process.env.AGENT_AI_API_KEY
    || process.env.OPENVIKING_AI_API_KEY
  const model = process.env.PERSONA_MODEL || 'step-3.7-flash'
  assert(apiBase, 'Missing PERSONA_AI_BASE_URL, AGENT_AI_BASE_URL, or OPENVIKING_AI_BASE_URL')
  assert(apiKey, 'Missing PERSONA_AI_API_KEY, AGENT_AI_API_KEY, or OPENVIKING_AI_API_KEY')
  return { apiBase, apiKey, model }
}
