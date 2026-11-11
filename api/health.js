import { getModelOptions, DEFAULT_MODEL } from '../lib/modelConfig.js'
import { TABLE_NAME, isSupabaseConfigured, listNameHistory } from '../lib/supabase.js'

// GET /api/health —— 一眼看清「模型密钥 / Supabase 表」两件事是否就绪
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: '只支持 GET 请求' })
  }

  const models = getModelOptions()
  const configuredModels = models.filter((m) => m.configured && !m.demo).map((m) => m.value)

  let supabase = { configured: isSupabaseConfigured(), table: TABLE_NAME, readable: false, error: null }
  if (supabase.configured) {
    const probe = await listNameHistory({ limit: 1, offset: 0 })
    supabase.readable = probe.ok
    supabase.error = probe.ok ? null : probe.reason
  }

  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({
    ok: configuredModels.length > 0 && supabase.readable,
    defaultModel: DEFAULT_MODEL,
    models,
    configuredModels,
    demoEnabled: models.some((m) => m.demo),
    supabase,
  })
}
