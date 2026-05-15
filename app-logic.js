(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  root.AnkangLogic = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_TARGETS = { high: 140, low: 90, pulse: 100 }
const ANALYTICS_META_ALLOWLIST = new Set([
  'action',
  'page',
  'period',
  'time_bucket',
  'method',
  'result',
  'source',
])

function parseDateOnly(value) {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate())
  const [year, month, day] = String(value).split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatDateOnly(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function inclusiveDayCount(start, end) {
  return Math.round((parseDateOnly(end) - parseDateOnly(start)) / DAY_MS) + 1
}

function average(values) {
  if (!values.length) return 0
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function getTimeBucket(time) {
  const match = String(time || '').match(/^(\d{1,2}):(\d{2})/)
  if (!match) return 'unknown'
  const hour = Number(match[1])
  if (hour >= 5 && hour < 10) return 'morning'
  if (hour >= 10 && hour < 13) return 'noon'
  if (hour >= 13 && hour < 18) return 'afternoon'
  if (hour >= 18 && hour < 22) return 'evening'
  if (hour >= 0 && hour < 24) return 'night'
  return 'unknown'
}

function getBPStatus(high, low, targets = DEFAULT_TARGETS) {
  const highLimit = Number(targets.high || DEFAULT_TARGETS.high)
  const lowLimit = Number(targets.low || DEFAULT_TARGETS.low)
  if (Number(high) >= highLimit || Number(low) >= lowLimit) return 'danger'
  if (Number(high) >= highLimit - 10 || Number(low) >= lowLimit - 10) return 'warning'
  return 'normal'
}

function worseStatus(statuses) {
  if (statuses.includes('danger')) return 'danger'
  if (statuses.includes('warning')) return 'warning'
  return 'normal'
}

function describeConclusion(summary) {
  if (summary.dataDayCount === 0) return '暂无趋势数据'
  if (summary.riskDayCount > 0) return `${summary.periodLabel}有 ${summary.riskDayCount} 天偏高，建议继续观察`
  if (summary.warningDayCount > 0) return `${summary.periodLabel}整体接近上限，注意规律测量`
  if (summary.missingDayCount > summary.totalDays / 2) return `${summary.periodLabel}记录偏少，建议固定时间测量`
  if (summary.change.direction === 'down') return `${summary.periodLabel}整体平稳，较前一周期下降`
  return `${summary.periodLabel}整体平稳`
}

function summarizeDays(days, records, targets, periodLabel, change = { high: null, low: null, direction: 'none' }) {
  const dataDays = days.filter(day => day.hasData)
  const riskRecords = records.filter(record => getBPStatus(record.high, record.low, targets) === 'danger')
  const riskDays = dataDays.filter(day => day.status === 'danger')
  const warningDays = dataDays.filter(day => day.status === 'warning')
  const normalDays = dataDays.filter(day => day.status === 'normal')
  const avgHigh = average(dataDays.map(day => day.high))
  const avgLow = average(dataDays.map(day => day.low))
  const pulseDays = dataDays.filter(day => day.pulse > 0)
  const summary = {
    periodLabel,
    totalDays: days.length,
    dataDayCount: dataDays.length,
    missingDayCount: days.length - dataDays.length,
    normalDayCount: normalDays.length,
    warningDayCount: warningDays.length,
    riskDayCount: riskDays.length,
    riskRecordCount: riskRecords.length,
    avgHigh,
    avgLow,
    avgPulse: pulseDays.length ? average(pulseDays.map(day => day.pulse)) : 0,
    maxHigh: dataDays.length ? Math.max(...dataDays.map(day => day.maxHigh)) : 0,
    maxLow: dataDays.length ? Math.max(...dataDays.map(day => day.maxLow)) : 0,
    avgPulsePressure: dataDays.length ? average(dataDays.map(day => day.high - day.low)) : 0,
    change,
    conclusion: '',
  }
  summary.conclusion = describeConclusion(summary)
  return summary
}

function buildDays(records, start, end, targets) {
  const byDate = new Map()
  records.forEach(record => {
    if (!record || !record.date) return
    if (record.date < start || record.date > end) return
    if (!byDate.has(record.date)) byDate.set(record.date, [])
    byDate.get(record.date).push(record)
  })

  const days = []
  let cursor = parseDateOnly(start)
  const endDate = parseDateOnly(end)
  while (cursor <= endDate) {
    const date = formatDateOnly(cursor)
    const label = `${cursor.getMonth() + 1}/${cursor.getDate()}`
    const dayRecords = byDate.get(date) || []

    if (!dayRecords.length) {
      days.push({
        date,
        label,
        hasData: false,
        high: 0,
        low: 0,
        pulse: 0,
        maxHigh: 0,
        maxLow: 0,
        count: 0,
        status: 'missing',
      })
    } else {
      const pulseRecords = dayRecords.filter(record => Number(record.pulse) > 0)
      days.push({
        date,
        label,
        hasData: true,
        high: average(dayRecords.map(record => Number(record.high))),
        low: average(dayRecords.map(record => Number(record.low))),
        pulse: pulseRecords.length ? average(pulseRecords.map(record => Number(record.pulse))) : 0,
        maxHigh: Math.max(...dayRecords.map(record => Number(record.high))),
        maxLow: Math.max(...dayRecords.map(record => Number(record.low))),
        count: dayRecords.length,
        status: worseStatus(dayRecords.map(record => getBPStatus(record.high, record.low, targets))),
      })
    }
    cursor = addDays(cursor, 1)
  }
  return days
}

function rangeRecords(records, start, end) {
  return records.filter(record => record && record.date >= start && record.date <= end)
}

function computeChange(records, start, end, targets) {
  const length = inclusiveDayCount(start, end)
  const prevEnd = addDays(parseDateOnly(start), -1)
  const prevStart = addDays(prevEnd, -(length - 1))
  const prevStartStr = formatDateOnly(prevStart)
  const prevEndStr = formatDateOnly(prevEnd)
  const prevDays = buildDays(records, prevStartStr, prevEndStr, targets)
  const previousDataDays = prevDays.filter(day => day.hasData)
  if (!previousDataDays.length) return { high: null, low: null, direction: 'none' }

  const currentDays = buildDays(records, start, end, targets).filter(day => day.hasData)
  if (!currentDays.length) return { high: null, low: null, direction: 'none' }

  const high = average(currentDays.map(day => day.high)) - average(previousDataDays.map(day => day.high))
  const low = average(currentDays.map(day => day.low)) - average(previousDataDays.map(day => day.low))
  const combined = high + low
  return {
    high,
    low,
    direction: combined < 0 ? 'down' : combined > 0 ? 'up' : 'flat',
  }
}

function buildTrendModel(records, options) {
  const targets = { ...DEFAULT_TARGETS, ...(options.targets || {}) }
  const start = typeof options.start === 'string' ? options.start : formatDateOnly(options.start)
  const end = typeof options.end === 'string' ? options.end : formatDateOnly(options.end)
  const periodLabel = options.periodLabel || `${inclusiveDayCount(start, end)}天`
  const days = buildDays(records, start, end, targets)
  const selectedRecords = rangeRecords(records, start, end)
  const change = computeChange(records, start, end, targets)

  return {
    start,
    end,
    days,
    summary: summarizeDays(days, selectedRecords, targets, periodLabel, change),
  }
}

function normalizeRecord(record, options = {}) {
  const now = options.now || new Date().toISOString()
  const id = record._id || options.id || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
  return {
    ...record,
    _id: id,
    high: Number(record.high),
    low: Number(record.low),
    pulse: record.pulse ? Number(record.pulse) : 0,
    source: record.source || 'local',
    syncStatus: record.syncStatus || 'local-only',
    createdAt: record.createdAt || now,
    updatedAt: now,
  }
}

function createMockMonthRecords(options = {}) {
  const days = Number(options.days || 30)
  const endDate = parseDateOnly(options.endDate || new Date())
  const startDate = addDays(endDate, -(days - 1))
  const batchId = options.batchId || `demo-${formatDateOnly(endDate)}`
  const records = []

  for (let i = 0; i < days; i++) {
    const date = formatDateOnly(addDays(startDate, i))
    const wave = Math.sin(i / 4) * 6
    const stress = [6, 7, 18, 19, 24].includes(i) ? 14 : 0
    const recovery = i > 20 ? -6 : 0
    const baseHigh = Math.round(130 + wave + stress + recovery)
    const baseLow = Math.round(82 + Math.sin(i / 5) * 4 + (stress ? 7 : 0) + (recovery ? -3 : 0))
    const basePulse = Math.round(72 + Math.cos(i / 6) * 5 + (stress ? 6 : 0))
    const hasEvening = i % 4 === 1 || i % 7 === 0
    const medication = i % 9 !== 2

    records.push(normalizeRecord({
      _id: `${batchId}-${i}-m`,
      date,
      time: '08:10',
      high: clamp(baseHigh, 112, 158),
      low: clamp(baseLow, 70, 99),
      pulse: clamp(basePulse, 58, 96),
      medication,
      note: '',
      isMock: true,
      mockBatchId: batchId,
    }, { id: `${batchId}-${i}-m`, now: `${date}T00:10:00.000Z` }))

    if (hasEvening) {
      records.push(normalizeRecord({
        _id: `${batchId}-${i}-e`,
        date,
        time: '20:30',
        high: clamp(baseHigh + (stress ? 4 : -4), 108, 162),
        low: clamp(baseLow + (stress ? 2 : -2), 68, 102),
        pulse: clamp(basePulse + 3, 58, 100),
        medication,
        note: '',
        isMock: true,
        mockBatchId: batchId,
      }, { id: `${batchId}-${i}-e`, now: `${date}T12:30:00.000Z` }))
    }
  }

  return records
}

function removeMockRecords(records) {
  const kept = records.filter(record => !record.isMock)
  return {
    kept,
    removedCount: records.length - kept.length,
  }
}

function buildAnonymousAnalyticsPayload(event, meta = {}, context = {}) {
  const cleanMeta = {}
  Object.entries(meta || {}).forEach(([key, value]) => {
    if (!ANALYTICS_META_ALLOWLIST.has(key)) return
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      cleanMeta[key] = value
    }
  })

  return {
    event: String(event).replace(/[^a-z0-9_:-]/gi, '').slice(0, 64),
    ts: context.now || new Date().toISOString(),
    sessionId: context.sessionId || '',
    appVersion: context.appVersion || '1.0.0',
    meta: cleanMeta,
  }
}

function safeText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength)
}

function buildFeedbackPayload(input = {}, context = {}) {
  const allowedTypes = new Set(['问题反馈', '功能建议', '使用咨询', '其他'])
  const type = allowedTypes.has(input.type) ? input.type : '其他'
  return {
    feedbackId: context.id || `fb-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    submittedAt: context.now || new Date().toISOString(),
    type,
    content: safeText(input.content, 1000),
    contact: safeText(input.contact, 120),
    page: safeText(input.page || 'unknown', 32),
    device: safeText(input.device, 160),
    sessionId: context.sessionId || '',
    appVersion: context.appVersion || '1.0.0',
  }
}

const api = {
  buildTrendModel,
  buildAnonymousAnalyticsPayload,
  buildFeedbackPayload,
  normalizeRecord,
  createMockMonthRecords,
  removeMockRecords,
  getBPStatus,
  getTimeBucket,
  formatDateOnly,
}

return api
})
