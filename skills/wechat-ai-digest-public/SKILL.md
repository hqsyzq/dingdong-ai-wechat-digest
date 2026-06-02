---
name: wechat-ai-digest-public
description: 维护或扩展一个开源的微信公众号 AI 日报 Cloudflare Worker 时使用，包括资讯源抓取、新鲜度过滤、微信公众号草稿创建、文章渲染、部署和故障排查。这个公开 skill 必须使用通用占位信息，不能包含私有项目路径、账号专属 URL 或密钥。
metadata:
  short-description: 维护开源版微信公众号 AI 日报 Worker
---

# 微信 AI 日报公开 Skill

用于开源版微信公众号 AI 日报 Worker。

## 适用范围

- 运行在 Cloudflare Workers 上的 AI 资讯抓取和微信公众号草稿创建项目
- 兼容 OpenAI 接口格式的大模型生成
- 微信兼容 HTML 渲染
- 新鲜度过滤和近期草稿去重
- 资讯源检查、部署和故障排查

这个公开 skill 必须保持通用。不要加入私有本地路径、账号名、Worker URL、API key、access token 或用户专属部署快捷命令。

## 仓库结构

预期文件：

- `index.js`：Worker 路由、cron 处理、资讯源抓取、LLM 调用、微信 API 调用
- `article-renderer.js`：Markdown 到微信兼容 HTML 的渲染器
- `wrangler.toml`：Worker 配置和定时任务
- `renderer-smoke-test.mjs`：渲染器冒烟测试
- `README.md`：安装、配置和运行说明

## 安全规则

- 不要打印或提交任何密钥
- 使用 `wrangler secret put` 设置：
  - `WECHAT_APP_ID`
  - `WECHAT_APP_SECRET`
  - `THUMB_MEDIA_ID`
  - `SHARED_SECRET`
  - `LLM_API_KEY`
- 忽略 `.wrangler/`、`.env`、日志、截图和本地配置
- 生成草稿会消耗大模型 token
- 资讯源检查和部署检查不会消耗大模型 token
- 除非公众号拥有 `freepublish` 权限，否则保持 `AUTO_PUBLISH = "false"`

## 工作流程

1. 修改前先阅读相关文件。
2. 优先用代码侧校验和过滤解决问题，不要只依赖提示词。
3. 运行检查：

```bash
npm run check
```

4. 部署：

```bash
npx wrangler deploy
```

5. 手动生成时，调用 `POST /generate` 并设置 `draftOnly: true`。

## 受保护接口

所有受保护接口都需要 JSON body 字段 `secret`，值等于 `SHARED_SECRET`。

- `POST /generate`：生成文章并创建草稿，会消耗大模型 token
- `POST /source-status`：检查资讯候选，不消耗大模型 token
- `POST /publication-status`：检查近期草稿和发布内容，不消耗大模型 token
- `POST /model-info`：检查模型供应商和模型名，不暴露 key
- `POST /debug`：检查必要环境变量是否存在
- `POST /publish-existing`：根据 `media_id` 尝试发布已有草稿

## 内容策略

- 如果有可用的国内候选，应包含中国国内 AI 资讯
- 优先选择官方、政策、公司和产业来源，而不是泛泛的媒体改写
- 避免重复近期草稿中已经出现过的旧闻
- 来源行应具体、可核验，优先使用直接 URL
- 避免只写 `来源`、`X`、`Twitter` 或单纯平台名

## 新鲜度

调用大模型前：

- 获取近期微信公众号草稿
- 提取历史标题、摘要、正文和 URL
- 规范化标题，标准化 URL
- 过滤已经在近期草稿中出现过的候选
- 在 `source-status` 中报告原始数量和过滤后数量

如果仍然出现旧闻，先加强代码侧过滤。

## 微信渲染

微信移动端会移除或弱化很多 CSS 效果。优先使用：

- 简单 HTML 标签
- inline style
- 明确的上下间距
- `background-color`，而不是复杂 CSS 效果

避免依赖外部 CSS、伪元素或 `text-align: justify`。

## 常见故障

- `Too many subrequests by single Worker invocation`：减少资讯源数量、RSSHub 镜像重试次数或外部页面抓取次数
- `Unauthorized`：检查 `SHARED_SECRET`
- `48001 api unauthorized`：公众号缺少发布接口权限，但通常仍可创建草稿
- 没有国内资讯：检查 `source-status`，再调整国内源路由或过滤逻辑
- 重复旧话题：改进 URL 标准化、标题规范化或近期草稿窗口
