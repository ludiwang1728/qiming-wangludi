# 名启 · AI 起名平台

《练习三：开发一个 AI 赋能的平台》的完整实现：用户在页面上写下起名需求，AI **流式**吐出 3 组名字 + 读音 + 寓意 + 气质，记录自动存进 Supabase，可在 **豆包 / DeepSeek / 通义千问 / Kimi** 之间切换模型。

四个阶段一次做齐：单模型跑通 → 抽成 `modelConfigMap` 多模型 → 建表入库 → 推 GitHub + Vercel 上线。

---

## 一、目录结构

```
ai-naming-platform/
├── package.json            # 依赖与三条命令：dev:local / dev / test
├── vercel.json             # 起名接口最长执行 60 秒（流式生成需要）
├── .gitignore              # 已排除 .env*，密钥不会进仓库
├── .env.example            # 环境变量模板，复制成 .env 再填值
├── index.html              # 单页前端：需求表单 + 模型下拉 + 流式结果 + 历史
├── api/
│   ├── name.js             # POST /api/name     起名（SSE 流式）并自动落库
│   ├── models.js           # GET  /api/models   下拉框数据源（不含密钥）
│   ├── history.js          # GET  /api/history  历史分页
│   └── health.js           # GET  /api/health   自检：密钥/表是否就绪
├── lib/
│   ├── modelConfig.js      # modelConfigMap：四个模型的地址/模型/密钥变量名
│   ├── prompt.js           # 起名提示词，锁死"恰好 3 组 + 固定格式"
│   ├── supabase.js         # 落库与查询，并把 PostgREST 报错翻成人话
│   └── demoModel.js        # 演示模型：无密钥时本地模拟流式输出
├── supabase/
│   └── schema.sql          # 建表 + 索引 + RLS 策略，粘到 SQL Editor 直接跑
└── scripts/
    ├── dev-server.mjs      # 不装 vercel CLI 也能本地跑的开发服务器
    └── smoke-test.mjs      # 端到端自检（假模型 + 假 Supabase，不烧额度）
```

---

## 二、本地跑起来（4 步）

### 1. 装依赖

```bash
cd ai-naming-platform
npm install
```

### 2. 建 Supabase 表

登录 [Supabase](https://supabase.com) → 打开项目 → 左侧 **SQL Editor** → New query → 粘贴 `supabase/schema.sql` 全文 → Run。

表结构与文档要求一致：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigint identity | 主键 |
| user_requirement | text | 用户的起名需求 |
| name_result | text | AI 生成的 3 组方案（纯文本） |
| model_name | text | 使用的模型：doubao / deepseek / qwen / kimi |
| created_at | timestamptz | 默认 now() |

`schema.sql` 末尾还带注释版的"临时关闭 RLS"和"上线前收紧权限"两种写法。

### 3. 配环境变量

```bash
cp .env.example .env
```

至少要填这两行（Supabase 控制台 → Project Settings → API）：

```dotenv
SUPABASE_URL=https://<你的项目ref>.supabase.co
SUPABASE_ANON_KEY=<你的 anon / publishable key>
```

想用真实大模型，再填任意一个（填几个就能切几个）：

```dotenv
DOUBAO_API_KEY=<火山方舟 API Key>
DOUBAO_MODEL=<推理接入点 ID，形如 ep-2025xxxx>
DEEPSEEK_API_KEY=<DeepSeek Key>
DASHSCOPE_API_KEY=<百炼 Key>
KIMI_API_KEY=<月之暗面 Key>
```

> 一个 key 都不填也能跑：`DEMO_MODE=1` 时下拉框里有一个「演示模型（本地模拟）」，本地生成示例文本，用来验证流式输出和入库是否通。

### 4. 启服务

两种方式二选一：

```bash
npm run dev:local     # 不依赖 vercel CLI，http://localhost:3105
# 或
npm run dev           # 等价于 vercel dev，需要先 npm i -g vercel 并 vercel login
```

打开页面，输入 `姓李，男孩，国风典雅，寓意坚韧`，点「开始起名」：文字一点点出现，右上角出现"已保存到 Supabase"，右侧历史里能翻到刚才这条。

### 自检命令

```bash
npm test              # 14 项端到端断言：模型列表 / SSE 分片 / 三组方案 / 落库 / 历史 / 各类报错
curl localhost:3105/api/health | python3 -m json.tool   # 看 key 与表是否就绪
```

---

## 三、四个阶段是怎么落地的

### 阶段 1：单模型跑通

最小版本只需 `api/name.js` 一个函数：读环境变量里的 key → `fetch` 模型平台的 `/chat/completions`（`stream: true`）→ 边读边把 `delta.content` 通过 SSE 写给浏览器。

### 阶段 2：抽成多模型

四家平台都提供 **OpenAI 兼容网关**，请求体、SSE 分片格式、`Authorization: Bearer` 鉴权头完全一致，所以差别只有"地址 + 模型名 + 密钥变量"。

`lib/modelConfig.js` 里一张表：

```js
export const modelConfigMap = {
  doubao:   { baseURL: 'https://ark.cn-beijing.volces.com/api/v1', apiKeyEnv: 'DOUBAO_API_KEY', model: 'doubao-seed-1-6-250615' },
  deepseek: { baseURL: 'https://api.deepseek.com/v1',              apiKeyEnv: 'DEEPSEEK_API_KEY', model: 'deepseek-chat' },
  qwen:     { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKeyEnv: 'DASHSCOPE_API_KEY', model: 'qwen-plus' },
  kimi:     { baseURL: 'https://api.moonshot.cn/v1',               apiKeyEnv: 'KIMI_API_KEY',     model: 'kimi-k2-0711-preview' },
}
```

`api/name.js` 全程只有一段 `fetch`，`config` 由前端传来的 `model` 查表得到 —— 加模型只加一行配置，主调用代码不动。

### 阶段 3：建表入库

- 表名 `name_history`，字段与文档一致；
- 写入走服务端 `@supabase/supabase-js`（`SUPABASE_ANON_KEY` 即可，配 `SERVICE_ROLE_KEY` 会优先用）；
- `lib/supabase.js` 会把 `PGRST205`（表没建）、`42501`（RLS 拦截）、JWT 失效翻译成页面上的中文提示，避免只看到 `Could not find the table ...`。

### 阶段 4：GitHub + Vercel

```bash
git add -A && git commit -m "feat: AI 起名平台"
git branch -M main
gh repo create <仓库名> --private --source=. --remote=origin --push   # 或 git push -u origin main
```

Vercel：Import 这个仓库 → 在 Project Settings → Environment Variables 填入与 `.env` 一致的变量（`SUPABASE_URL`、`SUPABASE_ANON_KEY`、四个 `*_API_KEY`、`DEMO_MODE`）→ Deploy → 拿到公网域名。

改完环境变量必须 **Redeploy** 才生效（Environment Variables 改动不会重跑旧部署）。

---

## 四、密钥与权限（上线前必读）

**密钥**
- 所有 key 只放环境变量，代码里没有任何硬编码；
- `.env` / `.env.local` 已在 `.gitignore` 中，`git status` 里不应出现；
- `SUPABASE_SERVICE_ROLE_KEY` 只允许在服务端用，绝不下发前端。

**RLS**
- 实验阶段：`schema.sql` 给的策略是 anon 可插入、可读取，方便讲"为什么能看到历史"；
- 正式上线：建议改成"每人只看自己的记录"，两种主流做法：
  1. 接入 Supabase Auth，策略改成 `using (auth.uid() = user_id)`，表里加 `user_id uuid`；
  2. 服务端用 `SERVICE_ROLE_KEY` 写入、前端只读，读取时按会话过滤。
- 无论如何，都不要把 RLS 长期关掉：anon key 在前端可见，关了等于把表公开。

---

## 五、常见踩坑

| 现象 | 原因 | 处理 |
|---|---|---|
| 下拉框全是"未配置密钥" | 环境变量没填或填了没 Redeploy | 补齐 key → Redeploy |
| 页面报 `表 name_history 还没创建` | 只建了项目没跑 SQL | SQL Editor 执行 `supabase/schema.sql` |
| 起名成功但历史为空 | RLS 拦了 insert 或 select | 执行 SQL 里的 policy，或临时关闭 RLS 排查 |
| 千问报 404 / 400 | 用了普通 dashscope 地址 | 必须 `compatible-mode/v1` |
| 切换某个模型就报错 | 模型 ID 不对 | 回到该平台文档核对 `model` 与地址 |
| 流式变成一次性返回 | 中间层做了缓冲 | 保留 `X-Accel-Buffering: no`，并确认没走会缓存的代理 |
