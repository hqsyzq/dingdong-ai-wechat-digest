# DingDong.ai 微信 AI 日报

这是一个运行在 Cloudflare Workers 上的微信公众号 AI 日报生成器。它会抓取 AI 相关资讯，调用兼容 OpenAI Chat Completions 格式的大模型生成中文日报，再把 Markdown 渲染成适合微信移动端阅读的 HTML，并创建到微信公众号草稿箱。

项目最初为 `DingDong.ai` 构建，但代码已做成通用结构，可以改造成其他公众号的每日资讯系统。

## 功能

- 通过 Cloudflare Cron Triggers 每日定时生成
- 自动创建微信公众号草稿
- 在账号权限允许时，可尝试自动发布
- 接入海外 AI 资讯、Hacker News、Builder 动态、博客、中国国内 AI 公司/政策/产业资讯
- 读取近期草稿并去重，减少重复旧闻
- 微信移动端友好的文章渲染器
- 提供受保护的手动接口，用于生成草稿、检查来源、查看模型配置和查看发布状态

## 架构

```text
Cron 或 HTTP 请求
  -> 抓取资讯源
  -> 过滤过期和重复内容
  -> 调用兼容 OpenAI 的 Chat Completions API
  -> 将 Markdown 渲染为微信兼容 HTML
  -> 创建微信公众号草稿
```

## 环境要求

- Node.js 18+
- Cloudflare Workers 账号
- Wrangler
- 微信公众号开发者凭据
- 一个兼容 OpenAI 接口格式的大模型 API
- 一个永久的微信公众号图片素材 ID，用作文章封面

## 安装与配置

安装依赖：

```bash
npm install
```

设置 Cloudflare Worker secrets：

```bash
npx wrangler secret put WECHAT_APP_ID
npx wrangler secret put WECHAT_APP_SECRET
npx wrangler secret put THUMB_MEDIA_ID
npx wrangler secret put SHARED_SECRET
npx wrangler secret put LLM_API_KEY
```

在 `wrangler.toml` 或 Cloudflare Dashboard 中配置非密钥变量：

```toml
[vars]
AUTO_PUBLISH = "false"
LLM_API_URL = "https://api.openai.com/v1"
LLM_MODEL = "gpt-4.1-mini"
```

如果你的公众号没有微信 `freepublish` 相关接口权限，请保持：

```toml
AUTO_PUBLISH = "false"
```

这样系统只会创建草稿，不会尝试自动发布。

## 开发

运行语法检查和渲染器冒烟测试：

```bash
npm run check
```

本地预览文章渲染效果：

```bash
npm run preview
```

部署到 Cloudflare Workers：

```bash
npx wrangler deploy
```

## 可选 Codex Skill

仓库内包含一个已脱敏的公开 Codex skill：

```text
skills/wechat-ai-digest-public/
```

它面向开源用户，只包含通用占位说明。

如果你为自己的部署维护了私有本地 Codex skill，请把它放在个人 Codex skills 目录中，不要提交到本仓库。私有 skill 可能包含本地路径、账号相关部署说明或个人操作习惯，不适合作为开源内容。

## 手动接口

所有受保护接口都需要在 JSON body 中传入 `secret` 字段，值需要等于 `SHARED_SECRET`。

- `POST /generate`
  - 示例：`{ "secret": "...", "draftOnly": true }`
  - 生成文章并创建微信公众号草稿
  - 会消耗大模型 token
- `POST /source-status`
  - 查看经过新鲜度和去重过滤后的资讯候选
  - 不调用大模型
- `POST /publication-status`
  - 查看近期草稿和已发布内容
  - 不调用大模型
- `POST /model-info`
  - 查看配置的 API URL、模型名，以及是否存在 API key
  - 不会返回 API key 本身
- `POST /debug`
  - 检查必要环境变量是否存在
  - 不会返回密钥值
- `POST /publish-existing`
  - 根据已有草稿的 `media_id` 尝试发布

## 微信接口权限说明

微信公众号的“创建草稿”和“发布草稿”是不同的接口权限。

如果调用 `freepublish` 相关接口时微信返回：

```text
48001 api unauthorized
```

说明当前账号没有自动发布权限。此时 Worker 仍然可以创建草稿，但不能自动发布。建议保持 `AUTO_PUBLISH = "false"`，然后在公众号后台手动发布。

## 安全注意事项

- 不要提交 `.wrangler`、`.env`、`.claude`、本地日志或任何真实密钥
- 如果密钥曾经暴露，请及时轮换
- `SHARED_SECRET` 应使用足够长的随机字符串
- 生成的草稿可能包含来源链接和模型供应商生成的编辑内容，发布前建议人工确认

## 许可证

MIT
