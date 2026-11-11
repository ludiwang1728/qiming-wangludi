// 端到端自检：用本地假模型 + 假 Supabase 跑通「起名 → 流式输出 → 落库 → 历史读取」
// 用法：npm test
// 不需要真实密钥，也不消耗任何模型额度
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const CANNED = `【方案一】李砚舟
读音：lǐ yàn zhōu
寓意：砚为文房之宝，象征读书治学；舟取“行舟万里”，寓意从容前行、胸有丘壑。
气质：书卷气，静水流深。

【方案二】李承煦
读音：lǐ chéng xù
寓意：承者担当，煦为春日暖阳，寓意温和而有担当，能给身边人带来暖意。
气质：温润大气，亲和。

【方案三】李知野
读音：lǐ zhī yě
寓意：知者明理，野取旷达之意，寓意既通事理又不被俗见所困，心怀开阔。
气质：现代简洁，清朗。`

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

/** 假模型服务：按 OpenAI 兼容协议流式返回 */
function startMockUpstream() {
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      let payload = {}
      try {
        payload = JSON.parse(raw)
      } catch {}
      const authed = /^Bearer\s+[^ ]+/.test(req.headers.authorization || '')
      if (!authed || !payload.stream) {
        res.statusCode = 401
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: { message: 'bad auth or not streaming' } }))
        return
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
      })
      // 按 12 字一片推送，模拟真实流式节奏
      const pieces = CANNED.match(/[\s\S]{1,12}/g) || []
      let i = 0
      const timer = setInterval(() => {
        if (i >= pieces.length) {
          clearInterval(timer)
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }
        const chunk = {
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: pieces[i] }, finish_reason: null }],
        }
        res.write(`data: ${JSON.stringify(chunk)}\n\n`)
        i += 1
      }, 8)
    })
  })
  return listen(server)
}

/** 假 Supabase（PostgREST 风格）：记录插入，供历史查询 */
function startMockSupabase() {
  const rows = []
  let nextId = 1
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (!url.pathname.startsWith('/rest/v1/name_history')) {
      res.statusCode = 404
      res.end('not found')
      return
    }

    if (req.method === 'POST') {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        let body = {}
        try {
          body = JSON.parse(raw)
        } catch {}
        const row = {
          id: nextId++,
          user_requirement: body.user_requirement,
          name_result: body.name_result,
          model_name: body.model_name,
          created_at: new Date().toISOString(),
        }
        rows.unshift(row)
        respondJson(req, res, row)
      })
      return
    }

    if (req.method === 'GET') {
      respondJson(req, res, rows.slice(0, 10))
      return
    }

    res.statusCode = 405
    res.end()
  })
  return listen(server).then((port) => ({ port, rows }))
}

// PostgREST：.single() 会带 application/vnd.pgrst.object+json，返回单个对象
function respondJson(req, res, data) {
  const accept = req.headers.accept || ''
  const single = accept.includes('vnd.pgrst.object')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.statusCode = 201
  res.end(JSON.stringify(single ? data : Array.isArray(data) ? data : [data]))
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function freePort() {
  const server = createServer()
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
}

async function waitForUrl(url, timeoutMs = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

async function main() {
  console.log('\n  端到端自检（本地假模型 + 假 Supabase）\n')

  const upstreamPort = await startMockUpstream()
  const sb = await startMockSupabase()
  const appPort = await freePort()

  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/dev-server.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(appPort),
      DOUBAO_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`,
      DOUBAO_API_KEY: 'test-key',
      DOUBAO_MODEL: 'test-model',
      SUPABASE_URL: `http://127.0.0.1:${sb.port}`,
      SUPABASE_ANON_KEY: 'test-anon-key',
      KIMI_API_KEY: '',
      DEEPSEEK_API_KEY: '',
      DASHSCOPE_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let childLog = ''
  child.stdout.on('data', (d) => (childLog += d.toString()))
  child.stderr.on('data', (d) => (childLog += d.toString()))

  const base = `http://127.0.0.1:${appPort}`
  let exitCode = 0

  try {
    const up = await waitForUrl(base + '/api/models')
    if (!up) throw new Error('本地服务未能启动：' + childLog.slice(0, 500))

    // 1. 模型列表
    const modelsRes = await fetch(base + '/api/models')
    const modelsData = await modelsRes.json()
    const models = modelsData.models || []
    const realModels = models.filter((m) => !m.demo)
    check('模型列表包含 4 个真实模型', realModels.length === 4, realModels.map((m) => m.value).join(','))
    check('演示模型默认可用', models.find((m) => m.value === 'demo')?.configured === true)
    check('已配置密钥的模型被标记为可用', models.find((m) => m.value === 'doubao')?.configured === true)

    // 2. 起名（流式）
    const nameRes = await fetch(base + '/api/name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requirement: '姓李，男孩，国风典雅，寓意坚韧', model: 'doubao' }),
    })
    check('起名接口返回 SSE', (nameRes.headers.get('content-type') || '').includes('text/event-stream'))

    let streamed = ''
    let doneMeta = null
    let deltaEvents = 0
    const reader = nameRes.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let firstChunkAt = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!firstChunkAt) firstChunkAt = Date.now()
      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() || ''
      for (const block of blocks) {
        for (const line of block.split('\n')) {
          if (!line.trim().startsWith('data:')) continue
          const json = JSON.parse(line.trim().slice(5).trim())
          if (json.delta) {
            streamed += json.delta
            deltaEvents += 1
          }
          if (json.done) doneMeta = json
        }
      }
    }

    check('流式分片数量 ≥ 3（确认是边生成边推送）', deltaEvents >= 3, `${deltaEvents} 片`)
    check('输出包含 3 组方案', ['【方案一】', '【方案二】', '【方案三】'].every((s) => streamed.includes(s)))
    check('每组都带读音与寓意', (streamed.match(/读音：/g) || []).length === 3 && (streamed.match(/寓意：/g) || []).length === 3)
    check('结束事件标记已保存', doneMeta?.saved === true, doneMeta ? `saved=${doneMeta.saved}, id=${doneMeta.savedId}` : '无 done 事件')
    check('落库内容与流式内容一致', sb.rows[0]?.name_result === streamed.trim())
    check('落库保存了用户需求与模型名', sb.rows[0]?.user_requirement === '姓李，男孩，国风典雅，寓意坚韧' && sb.rows[0]?.model_name === 'doubao')

    // 3. 历史记录
    const historyRes = await fetch(base + '/api/history?limit=10&offset=0')
    const historyData = await historyRes.json()
    check('历史接口读到刚保存的记录', historyData.items?.length === 1 && historyData.items[0].user_requirement.includes('姓李'))

    // 4. 参数校验
    const emptyRes = await fetch(base + '/api/name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requirement: '   ', model: 'doubao' }),
    })
    const emptyData = await emptyRes.json()
    check('空需求被拦截并给出提示', emptyRes.status === 400 && Boolean(emptyData.error), emptyData.error)

    // 5. 未配密钥的模型
    const kimiRes = await fetch(base + '/api/name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requirement: '女孩，现代简约', model: 'kimi' }),
    })
    const kimiData = await kimiRes.json()
    check('未配置密钥的模型给出明确提示', kimiRes.status === 400 && /KIMI_API_KEY/.test(kimiData.error || ''), kimiData.error)

    // 6. 非法模型
    const badRes = await fetch(base + '/api/name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requirement: '随便起个名', model: 'gpt-9' }),
    })
    check('非法模型被拦截', badRes.status === 400)
  } catch (err) {
    check('自检执行', false, err.message)
    exitCode = 1
  } finally {
    child.kill('SIGTERM')
  }

  const failed = results.filter((r) => !r.ok)
  if (failed.length) exitCode = 1
  console.log(`\n  结果：${results.length - failed.length}/${results.length} 通过\n`)
  process.exit(exitCode)
}

main()
