import { isSupabaseConfigured, listNameHistory } from '../lib/supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: '只支持 GET 请求' })
  }

  if (!isSupabaseConfigured()) {
    return res.status(200).json({
      items: [],
      total: 0,
      configured: false,
      error: '历史记录不可用：尚未配置 SUPABASE_URL / SUPABASE_ANON_KEY',
    })
  }

  const url = new URL(req.url, 'http://localhost')
  const result = await listNameHistory({
    limit: url.searchParams.get('limit'),
    offset: url.searchParams.get('offset'),
  })

  if (!result.ok) {
    return res.status(200).json({ items: [], total: 0, configured: true, error: result.reason })
  }

  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({ items: result.items, configured: true, error: null })
}
