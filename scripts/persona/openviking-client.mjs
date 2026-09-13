import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

export function personaOpenVikingConfig(cohortId = 'evaluation', { requireApiKey = true } = {}) {
  const baseUrl = (
    process.env.PERSONA_OPENVIKING_URL
    || `http://127.0.0.1:${process.env.OPENVIKING_PORT || '1933'}`
  ).replace(/\/$/, '')
  const rootAccount = process.env.OPENVIKING_ACCOUNT || 'social-cosmos'
  const suffix = cohortId.replace(/[^a-zA-Z0-9_-]/g, '-')
  const apiKey = openVikingApiKey(baseUrl)
  if (requireApiKey && !apiKey) {
    throw new Error('OPENVIKING_API_KEY is required for non-local Persona OpenViking services')
  }
  return {
    baseUrl,
    account: process.env.PERSONA_OPENVIKING_ACCOUNT || `${rootAccount}-persona-${suffix}`,
    apiKey,
    timeoutMs: Number(process.env.PERSONA_RECALL_TIMEOUT_MS || '60000'),
  }
}

export function openVikingApiKey(baseUrl) {
  if (process.env.OPENVIKING_API_KEY) return process.env.OPENVIKING_API_KEY
  const hostname = new URL(baseUrl).hostname
  if (!['openviking', '127.0.0.1', 'localhost'].includes(hostname)) return ''
  if (!process.env.OPENVIKING_AI_API_KEY) return ''
  const digest = createHash('sha256')
    .update(Buffer.from('social-cosmos-openviking-root\0'))
    .update(Buffer.from(process.env.OPENVIKING_AI_API_KEY))
    .digest('hex')
  return `ov-local-${digest}`
}

export function stableSessionId(account, userId, sessionKey) {
  const digest = createHash('sha256').update(`${account}:${userId}:${sessionKey}`).digest('hex')
  return `sc-${digest.slice(0, 32)}`
}

export class OpenVikingRequestError extends Error {
  constructor(message, statusCode, code = 'UNKNOWN') {
    super(message)
    this.name = 'OpenVikingRequestError'
    this.statusCode = statusCode
    this.code = code
  }
}

export async function openVikingRequest(config, method, path, { userId = '', allowNotFound = false, ...options } = {}) {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    ...options,
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(config.apiKey ? { 'x-api-key': config.apiKey } : {}),
      'x-openviking-account': config.account,
      ...(userId ? { 'x-openviking-user': userId } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(config.timeoutMs),
  })
  const payload = await response.json().catch(() => ({}))
  if (response.status === 404 && allowNotFound) return null
  if (!response.ok || payload.status === 'error') {
    throw new OpenVikingRequestError(
      payload.error?.message || `OpenViking returned HTTP ${response.status}`,
      response.status,
      payload.error?.code,
    )
  }
  return payload.result ?? payload
}

export async function recallOpenViking(config, userId, query, topK) {
  const result = await openVikingRequest(config, 'POST', '/api/v1/search/find', {
    userId,
    body: JSON.stringify({
      query,
      target_uri: `viking://user/${userId}/memories`,
      limit: topK,
      context_type: ['memory'],
    }),
  })
  return Array.isArray(result.memories) ? result.memories.slice(0, topK) : []
}

export async function commitOpenVikingDocument(config, unit, {
  pollIntervalMs = 2000,
  taskTimeoutMs = 240000,
} = {}) {
  const sessionId = stableSessionId(config.account, unit.userId, unit.sessionKey)
  const encodedSessionId = encodeURIComponent(sessionId)
  let session = await openVikingRequest(config, 'GET', `/api/v1/sessions/${encodedSessionId}`, {
    userId: unit.userId,
    allowNotFound: true,
  })
  if (!session) {
    try {
      await openVikingRequest(config, 'POST', '/api/v1/sessions', {
        userId: unit.userId,
        body: JSON.stringify({ session_id: sessionId }),
      })
    } catch (error) {
      if (!(error instanceof OpenVikingRequestError) || (error.statusCode !== 409 && error.code !== 'ALREADY_EXISTS')) {
        throw error
      }
    }
    session = await openVikingRequest(config, 'GET', `/api/v1/sessions/${encodedSessionId}`, {
      userId: unit.userId,
    })
  }

  let task
  if (Number(session.commit_count || 0) > 0) {
    const tasks = await openVikingRequest(
      config,
      'GET',
      `/api/v1/tasks?task_type=session_commit&resource_id=${encodeURIComponent(sessionId)}&limit=1`,
      { userId: unit.userId },
    )
    task = Array.isArray(tasks) ? tasks[0] : null
  } else {
    if (Number(session.message_count || 0) === 0) {
      const message = typeof unit.content === 'string'
        ? unit.content
        : JSON.stringify({
            dedupeKey: unit.dedupeKey,
            content: unit.content,
          })
      await openVikingRequest(config, 'POST', `/api/v1/sessions/${encodedSessionId}/messages`, {
        userId: unit.userId,
        body: JSON.stringify({ role: 'user', content: message }),
      })
    }
    task = await openVikingRequest(config, 'POST', `/api/v1/sessions/${encodedSessionId}/commit`, {
      userId: unit.userId,
      body: JSON.stringify({ keep_recent_count: 0, telemetry: false }),
    })
  }

  if (!task?.task_id) {
    if (String(task?.status || '').toLowerCase() === 'completed') return { sessionId, taskId: '', status: 'completed' }
    throw new Error(`No commit task found for ${unit.id}`)
  }
  const startedAt = Date.now()
  let current = task
  while (Date.now() - startedAt <= taskTimeoutMs) {
    const status = String(current.status || '').toLowerCase()
    if (['completed', 'complete', 'succeeded', 'success'].includes(status)) {
      return { sessionId, taskId: String(current.task_id), status: 'completed' }
    }
    if (!['accepted', 'queued', 'running', 'pending', 'processing'].includes(status)) {
      throw new Error(`OpenViking task ${current.task_id} ended with ${current.status}`)
    }
    await delay(pollIntervalMs)
    current = await openVikingRequest(config, 'GET', `/api/v1/tasks/${encodeURIComponent(current.task_id)}`, {
      userId: unit.userId,
    })
  }
  throw new Error(`OpenViking task ${current.task_id} did not finish within ${taskTimeoutMs}ms`)
}
