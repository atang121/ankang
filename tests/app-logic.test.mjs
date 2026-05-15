import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  buildTrendModel,
  buildAnonymousAnalyticsPayload,
  buildFeedbackPayload,
  normalizeRecord,
  getBPStatus,
  getTimeBucket,
  createMockMonthRecords,
  removeMockRecords,
} = require('../app-logic.js')

test('buildTrendModel uses daily averages for trend values and worst status for risk', () => {
  const model = buildTrendModel([
    { date: '2026-05-13', time: '08:00', high: 120, low: 78, pulse: 70 },
    { date: '2026-05-13', time: '20:00', high: 150, low: 92, pulse: 80 },
    { date: '2026-05-15', time: '08:00', high: 126, low: 82, pulse: 72 },
  ], {
    start: '2026-05-13',
    end: '2026-05-15',
    targets: { high: 140, low: 90, pulse: 100 },
  })

  assert.equal(model.days.length, 3)
  assert.deepEqual(
    model.days.map(day => ({ date: day.date, hasData: day.hasData, high: day.high, low: day.low, status: day.status })),
    [
      { date: '2026-05-13', hasData: true, high: 135, low: 85, status: 'danger' },
      { date: '2026-05-14', hasData: false, high: 0, low: 0, status: 'missing' },
      { date: '2026-05-15', hasData: true, high: 126, low: 82, status: 'warning' },
    ],
  )
  assert.equal(model.summary.avgHigh, 131)
  assert.equal(model.summary.avgLow, 84)
  assert.equal(model.summary.maxHigh, 150)
  assert.equal(model.summary.riskDayCount, 1)
  assert.equal(model.summary.riskRecordCount, 1)
  assert.equal(model.summary.warningDayCount, 1)
  assert.equal(model.summary.missingDayCount, 1)
  assert.match(model.summary.conclusion, /1 天偏高/)
})

test('buildTrendModel compares against previous equal-length period', () => {
  const model = buildTrendModel([
    { date: '2026-05-10', high: 140, low: 90 },
    { date: '2026-05-11', high: 136, low: 88 },
    { date: '2026-05-12', high: 132, low: 86 },
    { date: '2026-05-13', high: 128, low: 82 },
    { date: '2026-05-14', high: 126, low: 80 },
    { date: '2026-05-15', high: 124, low: 78 },
  ], {
    start: '2026-05-13',
    end: '2026-05-15',
    targets: { high: 140, low: 90, pulse: 100 },
  })

  assert.equal(model.summary.change.high, -10)
  assert.equal(model.summary.change.low, -8)
  assert.equal(model.summary.change.direction, 'down')
})

test('normalizeRecord adds migration-friendly metadata without changing readings', () => {
  const record = normalizeRecord(
    { date: '2026-05-15', time: '09:10', high: '126', low: '82', pulse: '72', note: 'morning' },
    { now: '2026-05-15T01:10:00.000Z', id: 'fixed-id' },
  )

  assert.equal(record._id, 'fixed-id')
  assert.equal(record.high, 126)
  assert.equal(record.low, 82)
  assert.equal(record.pulse, 72)
  assert.equal(record.source, 'local')
  assert.equal(record.syncStatus, 'local-only')
  assert.equal(record.createdAt, '2026-05-15T01:10:00.000Z')
  assert.equal(record.updatedAt, '2026-05-15T01:10:00.000Z')
})

test('buildAnonymousAnalyticsPayload strips health data and dates from metadata', () => {
  const payload = buildAnonymousAnalyticsPayload('record_save', {
    action: 'quick',
    page: 'index',
    time_bucket: 'morning',
    high: 150,
    low: 92,
    pulse: 80,
    date: '2026-05-15',
    note: '头晕',
    rangeStart: '2026-05-01',
    allowedExtra: 'ignored',
  }, {
    sessionId: 'session-1',
    appVersion: '1.1.0',
    userAgent: 'Mozilla/5.0',
  })

  assert.equal(payload.event, 'record_save')
  assert.equal(payload.sessionId, 'session-1')
  assert.equal(payload.appVersion, '1.1.0')
  assert.deepEqual(payload.meta, { action: 'quick', page: 'index', time_bucket: 'morning' })
  assert.equal('high' in payload.meta, false)
  assert.equal('low' in payload.meta, false)
  assert.equal('pulse' in payload.meta, false)
  assert.equal('date' in payload.meta, false)
  assert.equal('note' in payload.meta, false)
  assert.equal('userAgent' in payload, false)
})

test('buildFeedbackPayload keeps user-entered feedback and strips health data', () => {
  const payload = buildFeedbackPayload({
    type: '功能建议',
    content: '希望增加家人共享',
    contact: 'user@example.com',
    page: 'settings',
    device: 'iPhone Safari',
    high: 180,
    low: 110,
    pulse: 88,
    date: '2026-05-15',
    note: '头晕',
  }, {
    sessionId: 'session-1',
    appVersion: '1.2.0',
    now: '2026-05-15T01:00:00.000Z',
  })

  assert.equal(payload.type, '功能建议')
  assert.equal(payload.content, '希望增加家人共享')
  assert.equal(payload.contact, 'user@example.com')
  assert.equal(payload.page, 'settings')
  assert.equal(payload.device, 'iPhone Safari')
  assert.equal(payload.sessionId, 'session-1')
  assert.equal(payload.appVersion, '1.2.0')
  assert.equal('high' in payload, false)
  assert.equal('low' in payload, false)
  assert.equal('pulse' in payload, false)
  assert.equal('date' in payload, false)
  assert.equal('note' in payload, false)
})

test('getBPStatus treats configured upper limits as included in risk threshold', () => {
  assert.equal(getBPStatus(140, 80, { high: 140, low: 90 }), 'danger')
  assert.equal(getBPStatus(130, 85, { high: 140, low: 90 }), 'warning')
  assert.equal(getBPStatus(124, 78, { high: 140, low: 90 }), 'normal')
  assert.equal(getBPStatus(149, 94, { high: 150, low: 95 }), 'warning')
  assert.equal(getBPStatus(150, 80, { high: 150, low: 95 }), 'danger')
})

test('getTimeBucket groups record times without exposing exact time', () => {
  assert.equal(getTimeBucket('06:30'), 'morning')
  assert.equal(getTimeBucket('11:20'), 'noon')
  assert.equal(getTimeBucket('15:45'), 'afternoon')
  assert.equal(getTimeBucket('20:10'), 'evening')
  assert.equal(getTimeBucket('23:40'), 'night')
  assert.equal(getTimeBucket('bad'), 'unknown')
})

test('createMockMonthRecords creates varied marked records for the selected month', () => {
  const records = createMockMonthRecords({
    endDate: '2026-05-30',
    days: 30,
    batchId: 'demo-batch',
  })

  assert.equal(records.length >= 34, true)
  assert.equal(records.length <= 45, true)
  assert.equal(records.every(record => record.isMock === true), true)
  assert.equal(records.every(record => record.mockBatchId === 'demo-batch'), true)
  assert.equal(records[0].date, '2026-05-01')
  assert.equal(records.at(-1).date, '2026-05-30')
  assert.equal(records.some(record => record.high >= 140 || record.low >= 90), true)
  assert.equal(records.some(record => record.medication === false), true)
  assert.equal(new Set(records.map(record => record.date)).size, 30)
})

test('removeMockRecords removes only mock records', () => {
  const real = { _id: 'real-1', date: '2026-05-01', high: 126, low: 80 }
  const mock = { _id: 'mock-1', date: '2026-05-01', high: 148, low: 92, isMock: true }
  const result = removeMockRecords([real, mock])

  assert.deepEqual(result.kept, [real])
  assert.equal(result.removedCount, 1)
})
