import { DEFAULT_MODEL, getModelOptions } from '../lib/modelConfig.js'

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: '只支持 GET 请求' })
  }
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({
    defaultModel: DEFAULT_MODEL,
    models: getModelOptions(),
  })
}
