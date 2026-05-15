const API_ORIGIN = 'https://ankang-api.tangwaytoagi.workers.dev'

export async function onRequest(context) {
  const url = new URL(context.request.url)
  const target = new URL(url.pathname.replace(/^\/api/, '') + url.search, API_ORIGIN)

  const request = new Request(target.toString(), context.request)
  request.headers.set('Origin', url.origin)

  return fetch(request)
}
