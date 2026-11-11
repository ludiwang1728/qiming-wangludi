// 本地开发服务器：不需要 vercel CLI 也能跑起整个应用
// 用法：npm run dev:local（默认 http://localhost:3000）
// 它把 api/ 下的函数按 Vercel 的方式挂到 /api/*，并托管 index.html
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// 读取 .env（不覆盖已存在的环境变量）
function loadEnv() {
  const file = path.join(ROOT, '.env')
  if (!existsSync(file)) return
  const text = readFileSync(file, 'utf8')
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

const ROUTES = {
  '/api/name': path.join(ROOT, 'api/name.js'),
  '/api/history': path.join(ROOT, 'api/history.js'),
  '/api/models': path.join(ROOT, 'api/models.js'),
  '/api/health': path.join(ROOT, 'api/health.js'),
}

// 模拟 Vercel 给 res 附加的 status()/json() 帮助方法
function enhanceResponse(res) {
  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.json = (payload) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(payload))
    return res
  }
  return res
}

function readBody(req) {
  return new Promise((resolve) => {
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

loadEnv()
const PORT = Number(process.env.PORT) || 3000

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')

  try {
    // 静态首页
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = await readFile(path.join(ROOT, 'index.html'), 'utf8')
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(html)
      return
    }

    // API 路由
    const handlerPath = ROUTES[url.pathname]
    if (handlerPath) {
      const mod = await import(handlerPath)
      const handler = mod.default
      if (typeof handler !== 'function') {
        res.statusCode = 500
        res.end('handler 未导出 default 函数')
        return
      }
      if (!['GET', 'POST'].includes(req.method)) {
        res.statusCode = 405
        res.end('Method Not Allowed')
        return
      }
      req.body = req.method === 'POST' ? await readBody(req) : undefined
      enhanceResponse(res)
      await handler(req, res)
      return
    }

    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('404 Not Found')
  } catch (err) {
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: err?.message || '服务器内部错误' }))
    } else if (!res.writableEnded) {
      res.end()
    }
  }
})

server.listen(PORT, () => {
  console.log(`\n  AI 起名平台已启动：http://localhost:${PORT}\n`)
})
