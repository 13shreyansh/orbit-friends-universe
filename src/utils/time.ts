export const DISPLAY_TIME_ZONE = 'Asia/Shanghai'

let serverOffsetMs = 0
let clockCalibrated = false

export function calibrateServerClock(
  serverIso: string | null,
  requestStartedAt: number,
  responseReceivedAt = Date.now(),
) {
  if (!serverIso) return
  const serverTime = Date.parse(serverIso)
  if (!Number.isFinite(serverTime)) return
  const clientMidpoint = requestStartedAt + (responseReceivedAt - requestStartedAt) / 2
  serverOffsetMs = serverTime - clientMidpoint
  clockCalibrated = true
}

export function calibratedNow() {
  return new Date(Date.now() + (clockCalibrated ? serverOffsetMs : 0))
}

export function calibratedNowIso() {
  return calibratedNow().toISOString()
}

export function shanghaiDateInputValue(value: Date = calibratedNow()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function formatShanghaiTime(
  value: string | number | Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date)
}
