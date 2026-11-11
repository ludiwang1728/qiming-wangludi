import { createClient } from '@supabase/supabase-js'

let client = null

const TABLE = process.env.SUPABASE_TABLE || 'name_history'

/** 是否已配置 Supabase */
export function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && getApiKey())
}

function getApiKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
}

export function getSupabase() {
  if (!isSupabaseConfigured()) return null
  if (!client) {
    // 服务端使用，关闭会话持久化，避免在无状态函数里残留状态
    client = createClient(process.env.SUPABASE_URL, getApiKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return client
}

/**
 * 把 PostgREST 的原始报错翻成人话，前端直接展示
 * 三种典型情况：表没建（PGRST205 / 42P01）、RLS 拦截（42501）、密钥不匹配（JWT）
 */
function humanizeError(error) {
  const code = error?.code || ''
  const msg = error?.message || String(error?.details || '')
  if (code === 'PGRST205' || code === '42P01' || /could not find the table/i.test(msg)) {
    return `表 ${TABLE} 还没创建：请在 Supabase 的 SQL Editor 里执行 supabase/schema.sql`
  }
  if (code === '42501' || /row-level security/i.test(msg)) {
    return `表 ${TABLE} 的 RLS 策略拦住了写入/读取：执行 schema.sql 里的 policy，或临时关闭 RLS`
  }
  if (/invalid api key|jwt|apikey/i.test(msg)) {
    return 'Supabase 密钥无效：确认 SUPABASE_URL 与 SUPABASE_ANON_KEY 来自同一个项目'
  }
  return msg
}

/**
 * 保存一次起名记录
 * @returns {{ok: boolean, id?: number, reason?: string}}
 */
export async function saveNameHistory({ requirement, result, model }) {
  const supabase = getSupabase()
  if (!supabase) return { ok: false, reason: '未配置 SUPABASE_URL / SUPABASE_ANON_KEY' }

  const { data, error } = await supabase
    .from(TABLE)
    .insert({ user_requirement: requirement, name_result: result, model_name: model })
    .select('id')
    .single()

  if (error) return { ok: false, reason: humanizeError(error) }
  return { ok: true, id: data?.id }
}

/** 分页读取历史记录，最新在前 */
export async function listNameHistory({ limit = 20, offset = 0 } = {}) {
  const supabase = getSupabase()
  if (!supabase) return { ok: false, reason: '未配置 SUPABASE_URL / SUPABASE_ANON_KEY', items: [] }

  const from = Math.max(0, Number(offset) || 0)
  const size = Math.min(50, Math.max(1, Number(limit) || 20))
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, user_requirement, name_result, model_name, created_at')
    .order('created_at', { ascending: false })
    .range(from, from + size - 1)

  if (error) return { ok: false, reason: humanizeError(error), items: [] }
  return { ok: true, items: data || [] }
}

export { TABLE as TABLE_NAME }
