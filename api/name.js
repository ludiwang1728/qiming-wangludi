import { DEFAULT_MODEL, resolveApiKey, resolveModel } from '../lib/modelConfig.js'
import { buildMessages } from '../lib/prompt.js'
import { saveNameHistory } from '../lib/supabase.js'
import { buildDemoText, streamDemoText } from '../lib/demoModel.js'

const MAX_REQUIREMENT_LEN = 200

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: '只支持 POST 请求' })
  }

  // Vercel Node 函数通常会自动解析 JSON body；未解析时这里兜底读取
  let body = req.body
  if (body === undefined || body === null) {
    body = await readJsonBody(req)
  }
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      body = {}
    }
  }

  const requirement = String(body?.requirement ?? '').trim()
  const modelKey = String(body?.model ?? '').trim() || DEFAULT_MODEL

  if (!requirement) {
    return res.status(400).json({ error: '请先填写起名需求，例如“男孩、姓李、国风、寓意坚韧”' })
  }
  if (requirement.length > MAX_REQUIREMENT_LEN) {
    return res.status(400).json({ error: `起名需求最多 ${MAX_REQUIREMENT_LEN} 个字，请精简后重试` })
  }

  const config = resolveModel(modelKey)
  if (!config) {
    return res.status(400).json({ error: `不支持的模型：${modelKey}` })
  }

  const isDemo = Boolean(config.isDemo)
  const apiKey = isDemo ? '' : resolveApiKey(config)
  if (!isDemo && !apiKey) {
    return res.status(400).json({
      error: `模型「${config.label}」还没有配置密钥，请在环境变量中设置 ${config.apiKeyEnv} 后重新部署`,
    })
  }

  // 开始 SSE 流式响应
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  if (typeof res.flushHeaders === 'function') res.flushHeaders()

  const send = (payload) => {
    if (clientGone || res.writableEnded) return
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  let clientGone = false
  res.on('close', () => {
    if (!res.writableEnded) clientGone = true
  })

  const startedAt = Date.now()
  let fullText = ''

  // 演示模型：本地切片吐字，不走任何外部请求
  if (isDemo) {
    const demoText = buildDemoText(requirement)
    const finished = await streamDemoText(
      demoText,
      (chunk) => {
        fullText += chunk
        send({ delta: chunk })
      },
      () => clientGone,
    )
    if (!finished) {
      if (!res.writableEnded) res.end()
      return
    }

    const saved = await saveNameHistory({ requirement, result: fullText.trim(), model: modelKey })
    send({
      done: true,
      model: modelKey,
      modelLabel: config.label,
      elapsedMs: Date.now() - startedAt,
      saved: saved.ok,
      savedId: saved.id ?? null,
      saveError: saved.ok ? null : saved.reason,
    })
    if (!res.writableEnded) res.end()
    return
  }

  try {
    const upstream = await fetch(`${config.baseURL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: buildMessages(requirement),
        stream: true,
        temperature: 0.9,
      }),
      signal: AbortSignal.timeout(60_000),
    })

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '')
      const message = extractUpstreamError(detail) || `模型接口返回 ${upstream.status}`
      send({ error: `调用${config.label}失败：${message}` })
      res.end()
      return
    }

    const reader = upstream.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      // SSE 以空行事件分隔
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() ?? ''

      for (const block of blocks) {
        for (const line of block.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (!data || data === '[DONE]') continue

          try {
            const json = JSON.parse(data)
            const delta = json?.choices?.[0]?.delta?.content ?? ''
            if (typeof delta === 'string' && delta.length > 0) {
              fullText += delta
              send({ delta })
            }
          } catch {
            // 忽略无法解析的心跳或非标准分片
          }
        }
      }
    }

    if (!fullText.trim()) {
      send({ error: '模型没有返回任何内容，请换个模型或稍后重试' })
      res.end()
      return
    }

    // 落库：保存用户需求 + 名字方案 + 使用的模型
    const saved = await saveNameHistory({
      requirement,
      result: fullText.trim(),
      model: modelKey,
    })

    send({
      done: true,
      model: modelKey,
      modelLabel: config.label,
      elapsedMs: Date.now() - startedAt,
      saved: saved.ok,
      savedId: saved.id ?? null,
      saveError: saved.ok ? null : saved.reason,
    })
    res.end()
  } catch (error) {
    const message =
      error?.name === 'TimeoutError'
        ? '模型响应超时（60 秒），请稍后重试'
        : `起名失败：${error?.message || '未知错误'}`
    send({ error: message })
    if (!res.writableEnded) res.end()
  }
}

/** 从上游错误响应里提取一句人话 */
function extractUpstreamError(raw) {
  if (!raw) return ''
  try {
    const json = JSON.parse(raw)
    return json?.error?.message || json?.message || raw.slice(0, 200)
  } catch {
    return raw.slice(0, 200)
  }
}

/** 兜底读取请求体（某些运行时不会自动解析 JSON） */
function readJsonBody(req) {
  return new Promise((resolve) => {
    if (!req || typeof req.on !== 'function') return resolve({})
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve(raw)
      }
    })
    req.on('error', () => resolve({}))
  })
}
