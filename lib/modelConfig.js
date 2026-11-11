// 模型配置表：新增模型只需在这里加一条，主调用代码完全不用改
// 四家平台都提供 OpenAI 兼容接口：POST {baseURL}/chat/completions
// 密钥只放环境变量，任何一行都不写死 key
export const modelConfigMap = {
  doubao: {
    label: '豆包 · 火山方舟',
    baseURL: process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v1',
    // 火山方舟的模型 ID：控制台创建推理接入点后复制，形如 ep-2025xxxx 或 doubao-seed-1-6-250615
    apiKeyEnv: 'DOUBAO_API_KEY',
    model: process.env.DOUBAO_MODEL || 'doubao-seed-1-6-250615',
  },
  deepseek: {
    label: 'DeepSeek',
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  },
  qwen: {
    label: '通义千问 · 百炼',
    // 必须用 compatible-mode 地址，普通 dashscope 地址不兼容 OpenAI 协议
    baseURL: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    model: process.env.QWEN_MODEL || 'qwen-plus',
  },
  kimi: {
    label: 'Kimi · 月之暗面',
    baseURL: process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'KIMI_API_KEY',
    // 兼容官方文档里的旧变量名
    altKeyEnv: 'MOONSHOT_API_KEY',
    model: process.env.KIMI_MODEL || 'kimi-k2-0711-preview',
  },
  // 演示模型：不联网、不需要密钥，本地按同一份格式生成示例文本
  // 用途：还没拿到密钥时，先把「流式输出 → 落库 → 历史」整条链路跑通
  // 配 DEMO_MODE=0 即可在前端隐藏
  demo: {
    label: '演示模型（本地模拟）',
    baseURL: '',
    apiKeyEnv: '',
    model: 'local-demo',
    isDemo: true,
  },
}

export const DEFAULT_MODEL = 'doubao'

/** 演示模型是否对外开放 */
export function isDemoEnabled() {
  return process.env.DEMO_MODE !== '0'
}

/** 取模型配置，非法值返回 null */
export function resolveModel(key) {
  if (!key) return null
  if (!Object.prototype.hasOwnProperty.call(modelConfigMap, key)) return null
  const config = modelConfigMap[key]
  if (config.isDemo && !isDemoEnabled()) return null
  return config
}

/** 读取某个模型实际可用的密钥 */
export function resolveApiKey(config) {
  if (!config || !config.apiKeyEnv) return ''
  const primary = process.env[config.apiKeyEnv] || ''
  if (primary) return primary
  return config.altKeyEnv ? process.env[config.altKeyEnv] || '' : ''
}

/** 给前端的模型下拉框数据（不含任何密钥） */
export function getModelOptions() {
  return Object.entries(modelConfigMap)
    .filter(([, config]) => !config.isDemo || isDemoEnabled())
    .map(([value, config]) => ({
      value,
      label: config.label,
      model: config.model,
      // 演示模型永远可用
      configured: Boolean(config.isDemo) || Boolean(resolveApiKey(config)),
      demo: Boolean(config.isDemo),
    }))
}
