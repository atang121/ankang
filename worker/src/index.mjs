const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
}

const ALLOWED_ANALYTICS_META = new Set([
  'action',
  'page',
  'period',
  'time_bucket',
  'method',
  'result',
  'source',
])

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || ''
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)

  const allowOrigin = allowed.includes(origin) || allowed.includes('*')
    ? origin || '*'
    : (allowed[0] || '*')

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

function jsonResponse(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...corsHeaders(request, env),
    },
  })
}

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength)
}

function formatLocalDateTime(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return shifted.toISOString().slice(0, 19).replace('T', ' ')
}

function userAgentSummary(request) {
  return cleanText(request.headers.get('User-Agent'), 180)
}

function sanitizeAnalytics(input = {}) {
  const meta = {}
  Object.entries(input.meta || {}).forEach(([key, value]) => {
    if (!ALLOWED_ANALYTICS_META.has(key)) return
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      meta[key] = cleanText(value, 80)
    }
  })

  return {
    eventId: crypto.randomUUID(),
    receivedAt: formatLocalDateTime(),
    event: cleanText(String(input.event || '').replace(/[^a-z0-9_:-]/gi, ''), 64) || 'unknown',
    sessionId: cleanText(input.sessionId, 80),
    appVersion: cleanText(input.appVersion, 32),
    meta,
  }
}

function sanitizeFeedback(input = {}) {
  const allowedTypes = new Set(['问题反馈', '功能建议', '使用咨询', '其他'])
  const type = allowedTypes.has(input.type) ? input.type : '其他'

  return {
    feedbackId: cleanText(input.feedbackId, 80) || crypto.randomUUID(),
    submittedAt: formatLocalDateTime(),
    type,
    content: cleanText(input.content, 1000),
    contact: cleanText(input.contact, 120),
    page: cleanText(input.page, 32) || 'unknown',
    device: cleanText(input.device, 180),
  }
}

async function parseJson(request) {
  const contentType = request.headers.get('Content-Type') || ''
  if (!contentType.includes('application/json')) return {}
  return request.json()
}

async function getTenantAccessToken(env) {
  if (!env.LARK_APP_ID || !env.LARK_APP_SECRET) {
    throw new Error('Missing Lark app credentials')
  }

  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      app_id: env.LARK_APP_ID,
      app_secret: env.LARK_APP_SECRET,
    }),
  })

  const data = await response.json()
  if (!response.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`Lark token failed: ${data.msg || response.status}`)
  }

  return data.tenant_access_token
}

async function createBitableRecord(env, tableId, fields) {
  const token = await getTenantAccessToken(env)
  const url = `https://open.feishu.cn/open-apis/base/v3/bases/${env.LARK_BASE_TOKEN}/tables/${tableId}/records`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(fields),
  })

  const data = await response.json()
  if (!response.ok || data.code !== 0) {
    throw new Error(`Lark record failed: ${data.msg || response.status}`)
  }

  return data
}

async function handleCollect(request, env) {
  const input = await parseJson(request)
  const item = sanitizeAnalytics(input)

  await createBitableRecord(env, env.LARK_EVENT_TABLE_ID, {
    '事件ID': item.eventId,
    '接收时间': item.receivedAt,
    '事件名称': item.event,
    '匿名会话ID': item.sessionId,
    '应用版本': item.appVersion,
    '页面': item.meta.page || '',
    '动作': item.meta.action || '',
    '记录时间段': item.meta.time_bucket || '',
    '趋势周期': item.meta.period || '',
    '结果': item.meta.result || '',
    '来源': item.meta.source || '',
    'UserAgent摘要': userAgentSummary(request),
    '备注': item.meta.method ? `method=${item.meta.method}` : '',
  })

  return jsonResponse(request, env, { ok: true })
}

async function handleFeedback(request, env) {
  const input = await parseJson(request)
  const item = sanitizeFeedback(input)
  if (!item.content) return jsonResponse(request, env, { ok: false, error: 'content_required' }, 400)

  await createBitableRecord(env, env.LARK_FEEDBACK_TABLE_ID, {
    '反馈ID': item.feedbackId,
    '提交时间': item.submittedAt,
    '反馈类型': item.type,
    '反馈内容': item.content,
    '联系方式': item.contact,
    '来源页面': item.page,
    '设备/浏览器': item.device || userAgentSummary(request),
    '处理状态': '待处理',
    '回复内容': '',
  })

  return jsonResponse(request, env, { ok: true })
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(request, env) })
    }

    const url = new URL(request.url)
    if (request.method !== 'POST') {
      return jsonResponse(request, env, { ok: false, error: 'method_not_allowed' }, 405)
    }

    try {
      if (url.pathname === '/collect') return await handleCollect(request, env)
      if (url.pathname === '/feedback') return await handleFeedback(request, env)
      return jsonResponse(request, env, { ok: false, error: 'not_found' }, 404)
    } catch (error) {
      console.error(error)
      return jsonResponse(request, env, { ok: false, error: 'server_error' }, 500)
    }
  },
}
