import { markdownToHTML, removeEmptySections } from './article-renderer.js';

// ============================================================================
// WeChat OA Proxy — Cloudflare Worker (with Cron Trigger)
// ============================================================================
// Fully self-contained daily AI digest publishing:
//   - Cron trigger: fetch feeds → call LLM → save a WeChat draft by default
//   - Manual endpoint: POST /publish and POST /publish-draft
//
// Secrets (via wrangler secret put):
//   WECHAT_APP_ID, WECHAT_APP_SECRET, THUMB_MEDIA_ID, SHARED_SECRET
//   LLM_API_KEY, LLM_API_URL, LLM_MODEL
// Optional variable:
//   AUTO_PUBLISH=true to publish scheduled articles without review
// ============================================================================

const WECHAT_API = 'https://api.weixin.qq.com/cgi-bin';
const TOKEN_REFRESH_MARGIN = 1800;

// Secrets (populated from env at request start)
var WECHAT_APP_ID, WECHAT_APP_SECRET, THUMB_MEDIA_ID, SHARED_SECRET;
var LLM_API_KEY, LLM_API_URL, LLM_MODEL;

// Feed URLs — follow-builders (deep background)
const FEED_X_URL = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json';
const FEED_BLOGS_URL = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-blogs.json';

// Hacker News — broader tech news via Algolia search API
const HN_SEARCH = 'https://hn.algolia.com/api/v1/search_by_date?query=ai%20OR%20llm%20OR%20openai%20OR%20anthropic%20OR%20gemini%20OR%20agent%20OR%20model&tags=story&hitsPerPage=15';

// China AI news — RSSHub mirrors + official/company pages. Keep sources broad and filter locally.
const RSSHUB_BASES = [
  'https://rsshub.rssforever.com',
  'https://hub.slarker.me',
  'https://rsshub.pseudoyu.com',
  'https://rsshub.rss.tips',
  'https://rsshub.chn.moe',
  'https://rsshub.app'
];
const CHINA_RSSHUB_ROUTES = [
  { route: '/36kr/hot-list/24', source: '36氪热榜', category: 'media' },
  { route: '/infoq/recommend', source: 'InfoQ 中文', category: 'media' },
  { route: '/miit/news', source: '工信部新闻', category: 'policy' },
  { route: '/miit/zcjd', source: '工信部政策解读', category: 'policy' }
];

const CHINA_SEARCH_FEEDS = [
  { query: '阿里云 通义千问 Qwen 大模型', source: '百度搜索：通义千问 Qwen', category: 'official-watch' },
  { query: '百度智能云 文心一言 千帆 大模型', source: '百度搜索：文心 千帆', category: 'official-watch' },
  { query: '字节 豆包 火山引擎 大模型 AI', source: '百度搜索：豆包 火山引擎', category: 'official-watch' },
  { query: '智谱 AI GLM 大模型', source: '百度搜索：智谱 AI', category: 'official-watch' },
  { query: '月之暗面 Kimi 大模型', source: '百度搜索：Kimi', category: 'official-watch' },
  { query: 'DeepSeek 大模型 AI', source: '百度搜索：DeepSeek', category: 'official-watch' },
  { query: '工信部 人工智能 大模型 算力', source: '百度搜索：工信部 AI 政策', category: 'policy' },
  { query: '网信办 人工智能 生成式AI 算法 备案', source: '百度搜索：网信办 AI 政策', category: 'policy' }
];

const CHINA_WEB_SOURCES = [
  { url: 'https://qwenlm.github.io/blog/', source: 'Qwen 官方博客', category: 'official' },
  { url: 'https://www.zhipuai.cn/news', source: '智谱 AI 官方新闻', category: 'official' },
  { url: 'https://www.minimaxi.com/news', source: 'MiniMax 官方新闻', category: 'official' },
  { url: 'https://www.volcengine.com/', source: '火山引擎官方', category: 'official' },
  { url: 'https://www.miit.gov.cn/xwdt/gxdt/', source: '工信部工作动态', category: 'policy' },
  { url: 'https://www.cac.gov.cn/', source: '网信办', category: 'policy' },
  { url: 'https://www.caict.ac.cn/kxyj/qwfb/ztbg/', source: '中国信通院报告', category: 'industry' }
];

const CHINA_AI_KEYWORDS = [
  '人工智能', 'AI', 'AIGC', '大模型', '基础模型', '模型', 'LLM', '智能体', 'Agent',
  '生成式', '多模态', '算力', 'GPU', '芯片', '推理', '训练', '机器人', '自动驾驶',
  'DeepSeek', '通义', '千问', 'Qwen', '豆包', 'Kimi', '智谱', 'GLM', 'MiniMax',
  '月之暗面', '阶跃', '百川', '零一万物', '商汤', '文心', '混元', '阿里云',
  '百度', '腾讯', '字节', '火山引擎', '千帆', '网信办', '工信部', '科技部',
  '算法备案', '生成式人工智能', '语料', '数据标注', 'AI产业', '智能制造',
  '可信AI', '人工智能标准', '具身智能', '低空智能', '智能网联'
];

// ============================================================================
// Global state (cached in Worker memory)
// ============================================================================
let cachedToken = null;
let tokenExpiresAt = 0;

// ============================================================================
// Access Token Management
// ============================================================================
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < tokenExpiresAt - TOKEN_REFRESH_MARGIN) return cachedToken;

  const url = `${WECHAT_API}/token?grant_type=client_credential&appid=${WECHAT_APP_ID}&secret=${WECHAT_APP_SECRET}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.errcode) throw new Error(`WeChat token error [${data.errcode}]: ${data.errmsg}`);

  cachedToken = data.access_token;
  tokenExpiresAt = now + data.expires_in;
  return cachedToken;
}

// ============================================================================
// WeChat API Calls
// ============================================================================
async function createDraft(token, title, content, digest) {
  const body = {
    articles: [{
      title, content, digest: digest || '',
      author: 'AI日报',
      thumb_media_id: THUMB_MEDIA_ID,
      need_open_comment: 0,
      only_fans_can_comment: 0,
    }]
  };
  const res = await fetch(`${WECHAT_API}/draft/add?access_token=${token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.errcode) throw new Error(`Draft error [${data.errcode}]: ${data.errmsg}`);
  return data.media_id;
}

async function publishDraft(token, mediaId) {
  const res = await fetch(`${WECHAT_API}/freepublish/submit?access_token=${token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ media_id: mediaId })
  });
  const data = await res.json();
  if (data.errcode) throw new Error(`Publish error [${data.errcode}]: ${data.errmsg}`);
  return data.publish_id;
}

async function listDrafts(token, count = 10) {
  const res = await fetch(`${WECHAT_API}/draft/batchget?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offset: 0, count, no_content: 1 })
  });
  const data = await res.json();
  if (data.errcode) throw new Error(`Draft list error [${data.errcode}]: ${data.errmsg}`);
  return (data.item || []).map(item => ({
    media_id: item.media_id,
    update_time: item.update_time,
    title: item.content?.news_item?.[0]?.title || ''
  }));
}

async function listPublished(token, count = 10) {
  const res = await fetch(`${WECHAT_API}/freepublish/batchget?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offset: 0, count, no_content: 1 })
  });
  const data = await res.json();
  if (data.errcode) throw new Error(`Publish list error [${data.errcode}]: ${data.errmsg}`);
  return (data.item || []).map(item => ({
    article_id: item.article_id,
    update_time: item.update_time,
    title: item.content?.news_item?.[0]?.title || ''
  }));
}

async function listDraftReferences(token, count = 20) {
  try {
    const res = await fetch(`${WECHAT_API}/draft/batchget?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offset: 0, count, no_content: 0 })
    });
    const data = await res.json();
    if (data.errcode) throw new Error(`Draft reference list error [${data.errcode}]: ${data.errmsg}`);
    return (data.item || []).flatMap(item => {
      const newsItems = item.content?.news_item || [];
      return newsItems.map(article => ({
        media_id: item.media_id,
        update_time: item.update_time,
        title: article.title || '',
        digest: article.digest || '',
        content: article.content || ''
      }));
    });
  } catch (e) {
    console.log('Draft reference fetch error:', e.message);
    return [];
  }
}

// ============================================================================
// Feed Fetching
// ============================================================================
async function fetchJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// Hacker News Fetching (via Algolia — single request)
// ============================================================================
async function fetchHNStories() {
  try {
    const data = await fetchJSON(HN_SEARCH);
    if (!data?.hits) return [];
    return data.hits
      .filter(h => h.points > 5)
      .slice(0, 10)
      .map(h => ({
        title: h.title,
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        score: h.points,
        comments: h.num_comments || 0,
        source: 'hn'
      }));
  } catch (e) {
    console.log('HN fetch error:', e.message);
    return [];
  }
}

function stripHTML(value = '') {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHTMLEntities(value = '') {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeComparableText(value = '') {
  return stripHTML(decodeHTMLEntities(value))
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, '')
    .trim();
}

function canonicalizeURL(value = '') {
  try {
    const url = new URL(String(value).trim());
    url.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'spm', 'from'].forEach(key =>
      url.searchParams.delete(key));
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return '';
  }
}

function extractURLs(value = '') {
  return Array.from(String(value).matchAll(/https?:\/\/[^\s"'<>]+/g))
    .map(match => canonicalizeURL(match[0]))
    .filter(Boolean);
}

function buildUsedContentIndex(references = []) {
  const urls = new Set();
  const chunks = [];
  for (const ref of references) {
    const text = `${ref.title || ''}\n${ref.digest || ''}\n${ref.content || ''}`;
    chunks.push(normalizeComparableText(text));
    extractURLs(text).forEach(url => urls.add(url));
  }
  return {
    urls,
    text: chunks.join('\n')
  };
}

function wasRecentlyUsed(item, usedIndex) {
  if (!usedIndex) return false;
  const url = canonicalizeURL(item.url || '');
  if (url && usedIndex.urls.has(url)) return true;

  const title = normalizeComparableText(item.title || item.text || '');
  if (title.length < 12) return false;
  if (usedIndex.text.includes(title)) return true;

  const probeLength = Math.min(24, Math.max(14, Math.floor(title.length * 0.7)));
  return usedIndex.text.includes(title.slice(0, probeLength));
}

function filterUsedStories(items = [], usedIndex) {
  return items.filter(item => !wasRecentlyUsed(item, usedIndex));
}

function isRecentEnough(dateValue, days = 4) {
  if (!dateValue) return true;
  const time = Date.parse(dateValue);
  if (Number.isNaN(time)) return true;
  return Date.now() - time <= days * 24 * 60 * 60 * 1000;
}

function chinaAIKeywordScore(text) {
  const body = String(text || '');
  return CHINA_AI_KEYWORDS.reduce((score, keyword) =>
    body.toLowerCase().includes(keyword.toLowerCase()) ? score + 1 : score, 0);
}

function chinaReliabilityScore(item) {
  const url = String(item.url || '').toLowerCase();
  let score = 0;
  if (item.category === 'official') score += 8;
  if (item.category === 'policy') score += 7;
  if (item.category === 'official-watch') score += 4;
  if (item.category === 'industry') score += 3;

  const trustedDomains = [
    'miit.gov.cn', 'cac.gov.cn', 'most.gov.cn', 'gov.cn', 'caict.ac.cn',
    'aliyun.com', 'qwenlm.github.io', 'modelscope.cn', 'baidu.com', 'cloud.baidu.com',
    'tencent.com', 'cloud.tencent.com', 'volcengine.com', 'doubao.com',
    'zhipuai.cn', 'bigmodel.cn', 'moonshot.cn', 'kimi.com', 'minimax.io',
    'minimaxi.com', 'deepseek.com', 'sensecore.cn', 'sensetime.com'
  ];
  if (trustedDomains.some(domain => url.includes(domain))) score += 5;
  return score;
}

function normalizeRSSHubItem(item, feed) {
  const title = stripHTML(item.title || '');
  const url = item.url || item.external_url || item.id || '';
  const publishedAt = item.date_published || item.date_modified || item.pubDate || '';
  const summary = stripHTML(item.content_text || item.content_html || item.summary || item.description || '').slice(0, 280);
  return {
    title,
    url,
    source: feed.source,
    category: feed.category,
    publishedAt,
    summary,
    region: 'china'
  };
}

function normalizeSearchItem(item, feed) {
  return {
    ...normalizeRSSHubItem(item, feed),
    searchQuery: feed.query
  };
}

function normalizeURL(url, baseURL) {
  try {
    return new URL(decodeHTMLEntities(url), baseURL).toString();
  } catch {
    return '';
  }
}

function extractAnchors(html, baseURL) {
  const anchors = [];
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(html)) && anchors.length < 80) {
    const url = normalizeURL(match[1], baseURL);
    const title = stripHTML(decodeHTMLEntities(match[2]));
    if (!url || !title || title.length < 4) continue;
    anchors.push({ title, url });
  }
  return anchors;
}

function firstMatch(html, pattern) {
  const match = pattern.exec(html);
  return match ? stripHTML(decodeHTMLEntities(match[1])) : '';
}

function extractStructuredArticles(html, baseURL) {
  const articles = [];
  const articleRegex = /<article\b[\s\S]*?<\/article>/gi;
  let match;
  while ((match = articleRegex.exec(html)) && articles.length < 30) {
    const block = match[0];
    const title = firstMatch(block, /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i);
    const hrefMatch =
      /<a\b[^>]*class=["'][^"']*entry-link[^"']*["'][^>]*href=["']([^"']+)["']/i.exec(block) ||
      /<a\b[^>]*href=["']([^"']+)["'][^>]*aria-label=["'][^"']*post link/i.exec(block) ||
      /<a\b[^>]*href=["']([^"']+)["']/i.exec(block);
    const url = hrefMatch ? normalizeURL(hrefMatch[1], baseURL) : baseURL;
    const publishedAt =
      firstMatch(block, /<time\b[^>]*datetime=["']([^"']+)["']/i) ||
      firstMatch(block, /<span\b[^>]*title=["']([^"']+)["'][^>]*>/i);
    const summary = firstMatch(block, /<div\b[^>]*class=["'][^"']*entry-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i).slice(0, 280);
    if (title && url) articles.push({ title, url, publishedAt, summary });
  }
  return articles;
}

async function fetchRSSHubJSON(feed) {
  for (const base of RSSHUB_BASES.slice(0, 2)) {
    try {
      const separator = feed.route.includes('?') ? '&' : '?';
      const url = `${base}${feed.route}${separator}format=json`;
      const data = await fetchJSON(url);
      if (Array.isArray(data?.items)) {
        const normalize = feed.normalize || normalizeRSSHubItem;
        return data.items.map(item => normalize(item, feed));
      }
    } catch (e) {
      console.log('RSSHub fetch error:', feed.source, e.message);
    }
  }
  return [];
}

async function fetchRSSHubSearchJSON(feed) {
  const route = `/baidu/search/${encodeURIComponent(feed.query)}`;
  return fetchRSSHubJSON({ ...feed, route, normalize: normalizeSearchItem });
}

async function fetchOfficialWebSource(source) {
  try {
    const html = await fetchText(source.url);
    if (!html) return [];
    const pageTitle = firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const pageDescription =
      firstMatch(html, /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
      firstMatch(html, /<meta\b[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
    const candidates = [
      ...extractStructuredArticles(html, source.url),
      ...extractAnchors(html, source.url),
      { title: pageTitle, url: source.url, publishedAt: '', summary: pageDescription }
    ];
    const seen = new Set();
    return candidates
      .map(anchor => ({
        ...anchor,
        source: source.source,
        category: source.category,
        publishedAt: anchor.publishedAt || '',
        summary: anchor.summary || '',
        region: 'china'
      }))
      .filter(item => {
        const key = item.url || item.title;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .filter(item => chinaAIKeywordScore(`${item.title}\n${item.url}`) > 0)
      .slice(0, 8);
  } catch (e) {
    console.log('Official source fetch error:', source.source, e.message);
    return [];
  }
}

async function fetchChinaAIStories() {
  try {
    const batches = await Promise.all([
      ...CHINA_RSSHUB_ROUTES.map(fetchRSSHubJSON),
      ...CHINA_SEARCH_FEEDS.map(fetchRSSHubSearchJSON),
      ...CHINA_WEB_SOURCES.map(fetchOfficialWebSource)
    ]);
    const seen = new Set();
    const allStories = batches
      .flat()
      .filter(item => item.title && item.url)
      .filter(item => isRecentEnough(item.publishedAt))
      .map(item => ({
        ...item,
        keywordScore: chinaAIKeywordScore(`${item.title}\n${item.summary}`)
      }))
      .filter(item => item.keywordScore > 0)
      .filter(item => {
        const key = item.url || item.title;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => {
        const scoreA = a.keywordScore + chinaReliabilityScore(a);
        const scoreB = b.keywordScore + chinaReliabilityScore(b);
        return scoreB - scoreA;
      });

    const primary = allStories.filter(item =>
      item.category === 'official' || item.category === 'policy' || item.category === 'official-watch' || item.category === 'industry');
    const media = allStories.filter(item => !primary.includes(item));
    const selected = [...primary.slice(0, 10), ...media.slice(0, 18)];
    return selected.slice(0, 24);
  } catch (e) {
    console.log('China AI fetch error:', e.message);
    return [];
  }
}

// ============================================================================
// LLM Content Generation (Journalism Style)
// ============================================================================
async function generateDigest(feeds, hnStories, chinaStories) {
  const today = new Date().toISOString().slice(0, 10);
  const weekday = ['周日','周一','周二','周三','周四','周五','周六'][new Date().getDay()];

  // Summarize builder tweets into a compact briefing block
  const xBriefs = (feeds.x || []).map(b => ({
    name: b.name,
    bio: b.bio?.slice(0, 80) || '',
    tweets: (b.tweets || []).slice(0, 3).map(t => ({
      text: t.text?.slice(0, 200),
      url: t.url,
      likes: t.likes
    }))
  }));

  // Summarize blog posts
  const blogBriefs = (feeds.blogs || []).map(b => ({
    name: b.name,
    title: b.title,
    url: b.url,
    content: b.content?.slice(0, 500) || ''
  }));

  const chinaBriefs = (chinaStories || []).map(s => ({
    title: s.title,
    source: s.source,
    category: s.category,
    url: s.url,
    publishedAt: s.publishedAt,
    summary: s.summary?.slice(0, 220) || ''
  }));

  const systemPrompt = `你是一位资深科技媒体主编，每天为微信公众号撰写一篇 AI 行业日报。读者是对AI感兴趣的普通人，不是技术专家。

今天是 ${today} ${weekday}。

你的写作风格参考：极客公园、晚点LatePost、量子位 — 信息密度高、有编辑判断力、读起来像人类专业编辑写的稿子。

## 核心原则

1. 以「事件」为线索，不以「人」为线索。开头永远是「发生了什么」，不是「谁说了什么」
2. 每条新闻都要回答「为什么值得关注」。不要只转述，要加背景和判断
3. 中文本土化表达，不要翻译腔。像中国科技记者写稿，不像译稿
4. 标题要有吸引力，用数字、对比、问句制造张力
5. 段落要短。每段不超过3句话，适合手机阅读
6. 技术术语保留英文（AI, LLM, GPU, API, agent等），公司名/产品名保留原文
7. 数据要具体，不要「大幅增长」而要说「增长了40%」
8. 全文不准出现任何一个 emoji
9. 文章末尾不需要署名、来源说明或二维码引导
10. 不要出现「AI日报」「每日」等暴露自动生成痕迹的词汇
11. 如果某个板块没有内容，直接跳过，不要写「暂无」
12. 板块之间用 --- 分隔
13. 所有链接必须使用原始素材中的真实 URL，并以 Markdown 格式独占一行。链接文字规则：官方公告可写发布机构名，如 [OpenAI](url)；来自 X/Twitter 的内容必须写具体账号或博主名，如 [Aaron Levie](url)，禁止只写 X / Twitter；来自 Hacker News 或 GitHub 的项目内容可直接把完整 URL 作为链接文字，如 [https://github.com/...](https://github.com/...)
14. 文章必须兼顾国内外 AI 动态；如果「中国国内AI资讯候选」非空，至少选择 2 条国内事件进入「今日速览」或「今日头条」，不要因为海外资讯热度高而忽略国内事件
15. 国内资讯优先选择官方页面、政策源、大厂/模型公司直接动态，其次才是媒体二手报道；国内资讯要写出对中国读者的现实影响，不要只把媒体标题换一种说法
16. 候选素材已经过滤过近期草稿中用过的链接和标题。写作时继续坚持“最新优先”，不要主动回顾旧闻；没有新进展的旧事件不要写

## 输出模板（严格遵循）

# [标题：15-25字，有信息量和吸引力]

【今日头条】

[4-6句话的微型报道：新闻事实 + 背景 + 为什么重要 + 影响判断]

【今日速览】

[5-7条快讯，每条格式：]

**序号. 一句话标题**

2-3句话简述。每条末尾单独一行写真实链接；X/Twitter 内容用 [具体博主名](url)，项目或资讯页面可用 [完整网址](url)，不得写成 [来源](url) 或只标平台名

---

[下一条]

【深度解读】

[选1个话题深入展开，6-8句话。要有观点、有背景、有对立视角。展现编辑的判断力。]

【今日趣闻】

[1条轻松的AI见闻，给读者一个轻松的结尾]

## 内容选择标准
- 优先：产品发布、政策监管、大厂动向、融资消息、技术突破
- 其次：行业争议、趋势分析、有趣应用
- 国内优先级：政策/监管、国产大模型产品、大厂动作、融资、芯片/算力、机器人与智能硬件
- 跳过：纯学术论文、小众技术讨论、纯个人观点

## 字数控制
- 全文1200-2000字
- 头条：200-300字
- 每条速览：60-100字
- 深度解读：250-350字`;

  // Build context with all sources
  let contextBlock = '【中国国内AI资讯候选】\n';
  contextBlock += chinaBriefs.length
    ? JSON.stringify(chinaBriefs, null, 2)
    : '今日未抓取到高相关国内AI资讯，请不要硬编国内新闻。';

  contextBlock += '\n\n【Hacker News AI热门话题】\n';
  contextBlock += hnStories.map(s => `- [${s.score}↑ ${s.comments}评] ${s.title}\n  ${s.url}`).join('\n');

  contextBlock += '\n\n【AI行业Builder动态（X/Twitter）】\n';
  contextBlock += JSON.stringify(xBriefs, null, 2);

  contextBlock += '\n\n【AI公司官方博客】\n';
  contextBlock += JSON.stringify(blogBriefs, null, 2);

  let userMessage = `请根据以上原始素材，按照系统提示词中的模板和原则，撰写今天的AI日报。

重要提醒：
- 标题要有吸引力，让读者想点进去
- 头条选最有新闻价值的一条，不要贪多
- 速览覆盖不同领域（产品、政策、技术、资本），避免全是同一类
- 今日速览必须优先保证至少2条国内AI动态；如果国内有更重要事件，可以让国内事件做头条
- 国内AI动态优先从官方、大厂、政策和产业联盟源中选择，媒体热榜只能作为补充
- 只写最新进展。不要把前几天已经出现过、今天没有新进展的内容重新包装成新闻
- 深度解读要有你的编辑判断，不要只是事实复述
- 所有链接必须来自原始数据，不要编造
- 来源必须可核验：优先保留原始 URL；若素材来自 X/Twitter，必须同时给出相关博主或账号名字，不得只写平台名称
- 中文写稿，一气呵成，不要有翻译感
- 绝对禁止使用任何emoji
- 文章末尾不需要任何署名

原始素材：
${contextBlock}`;

  const res = await fetch(LLM_API_URL + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LLM_API_KEY}`
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.8,
      max_tokens: 8000
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

// ============================================================================
// JSON Helpers
// ============================================================================
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
function errorResponse(message, status = 400) {
  return jsonResponse({ status: 'error', message }, status);
}

// ============================================================================
// Main Content Generation & Publishing Flow
// ============================================================================
async function runDigest(env, draftOnly = false) {
  // 1. Fetch all sources in parallel
  const [feedX, feedBlogs, rawHNStories, rawChinaStories] = await Promise.all([
    fetchJSON(FEED_X_URL),
    fetchJSON(FEED_BLOGS_URL),
    fetchHNStories(),
    fetchChinaAIStories()
  ]);

  const token = await getAccessToken();
  const usedIndex = buildUsedContentIndex(await listDraftReferences(token));

  const xBuilders = (feedX?.x || [])
    .map(builder => ({
      ...builder,
      tweets: filterUsedStories(builder.tweets || [], usedIndex)
    }))
    .filter(builder => (builder.tweets || []).length > 0);
  const blogs = filterUsedStories(feedBlogs?.blogs || [], usedIndex);
  const hnStories = filterUsedStories(rawHNStories, usedIndex);
  const chinaStories = filterUsedStories(rawChinaStories, usedIndex);
  const totalTweets = xBuilders.reduce((s, a) => s + (a.tweets?.length || 0), 0);

  // 2. At minimum we need one usable source
  if (hnStories.length === 0 && chinaStories.length === 0 && totalTweets === 0 && blogs.length === 0) {
    return { status: 'skipped', reason: 'No newsworthy content today' };
  }

  // 3. Generate digest via LLM (journalism style)
  const digestText = await generateDigest(
    { x: xBuilders, blogs },
    hnStories,
    chinaStories
  );

  // 4. Extract title and strip from body (WeChat metadata already shows the title)
  const titleMatch = digestText.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : `AI 日报 | ${new Date().toISOString().slice(0, 10)}`;
  const bodyOnly = digestText.replace(/^#\s+.+\n+/, '');

  // 5. Extract digest from body (WeChat push summary — first substantive paragraph)
  const bodyLines = bodyOnly.split('\n');
  let digest = '';
  for (const line of bodyLines) {
    const t = line.trim();
    if (t && !/^#/.test(t) && !/^---/.test(t) && !/^>/.test(t) && !/^【/.test(t)) {
      digest = t.length > 100 ? t.slice(0, 100) + '...' : t;
      break;
    }
  }

  // 6. Remove empty/placeholder sections, then convert to HTML
  const cleanBody = removeEmptySections(bodyOnly);
  const htmlContent = markdownToHTML(cleanBody);
  const mediaId = await createDraft(token, title, htmlContent, digest);

  let publishId = null;
  if (!draftOnly) {
    publishId = await publishDraft(token, mediaId);
  }

  return {
    status: 'ok',
    published: !draftOnly,
    media_id: mediaId,
    publish_id: publishId,
    stats: {
      hnStories: hnStories.length,
      chinaStories: chinaStories.length,
      xBuilders: xBuilders.length,
      totalTweets,
      blogPosts: blogs.length,
      filtered: {
        hnStories: Math.max(0, rawHNStories.length - hnStories.length),
        chinaStories: Math.max(0, rawChinaStories.length - chinaStories.length)
      }
    }
  };
}

// ============================================================================
// Handler: Scheduled (Cron Trigger)
// ============================================================================
async function scheduled(event, env, ctx) {
  WECHAT_APP_ID = env.WECHAT_APP_ID;
  WECHAT_APP_SECRET = env.WECHAT_APP_SECRET;
  THUMB_MEDIA_ID = env.THUMB_MEDIA_ID;
  SHARED_SECRET = env.SHARED_SECRET;
  LLM_API_KEY = env.LLM_API_KEY;
  LLM_API_URL = env.LLM_API_URL;
  LLM_MODEL = env.LLM_MODEL;

  try {
    const autoPublish = env.AUTO_PUBLISH === 'true';
    const result = await runDigest(env, !autoPublish);
    console.log({ event: 'cron_result', autoPublish, result });
    return result;
  } catch (err) {
    console.error({ event: 'cron_error', autoPublish: env.AUTO_PUBLISH === 'true', error: err.message });
    throw err;
  }
}

// ============================================================================
// Handler: HTTP Request (Manual trigger)
// ============================================================================
async function handleRequest(request, env, ctx) {
  WECHAT_APP_ID = env.WECHAT_APP_ID;
  WECHAT_APP_SECRET = env.WECHAT_APP_SECRET;
  THUMB_MEDIA_ID = env.THUMB_MEDIA_ID;
  SHARED_SECRET = env.SHARED_SECRET;
  LLM_API_KEY = env.LLM_API_KEY;
  LLM_API_URL = env.LLM_API_URL;
  LLM_MODEL = env.LLM_MODEL;

  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
    });
  }

  // POST /publish — manual publish (content provided by caller)
  if (url.pathname === '/publish' && request.method === 'POST') {
    try {
      const body = await request.json();
      if (!body.secret || body.secret !== SHARED_SECRET) return errorResponse('Unauthorized', 401);
      if (!body.title || !body.content) return errorResponse('Missing title/content', 400);

      const htmlContent = markdownToHTML(body.content);
      const token = await getAccessToken();
      const mediaId = await createDraft(token, body.title, htmlContent, body.digest || '');
      const publishId = await publishDraft(token, mediaId);

      return jsonResponse({ status: 'ok', media_id: mediaId, publish_id: publishId });
    } catch (err) {
      return errorResponse(err.message, 500);
    }
  }

  // POST /publish-draft — manual draft only (no publish)
  if (url.pathname === '/publish-draft' && request.method === 'POST') {
    try {
      const body = await request.json();
      if (!body.secret || body.secret !== SHARED_SECRET) return errorResponse('Unauthorized', 401);
      if (!body.title || !body.content) return errorResponse('Missing title/content', 400);

      const htmlContent = markdownToHTML(body.content);
      const token = await getAccessToken();
      const mediaId = await createDraft(token, body.title, htmlContent, body.digest || '');

      return jsonResponse({ status: 'ok', media_id: mediaId, published: false });
    } catch (err) {
      return errorResponse(err.message, 500);
    }
  }

  // POST /generate — auto-generate + publish (cron-style manual trigger)
  if (url.pathname === '/generate' && request.method === 'POST') {
    try {
      const body = await request.json();
      if (!body.secret || body.secret !== SHARED_SECRET) return errorResponse('Unauthorized', 401);
      const draftOnly = body.draftOnly === true;
      const result = await runDigest(env, draftOnly);
      return jsonResponse(result);
    } catch (err) {
      return errorResponse(err.message, 500);
    }
  }

  // POST /model-info — inspect the configured provider/model without exposing API keys
  if (url.pathname === '/model-info' && request.method === 'POST') {
    try {
      const body = await request.json();
      if (!body.secret || body.secret !== SHARED_SECRET) return errorResponse('Unauthorized', 401);
      return jsonResponse({
        api_url: LLM_API_URL || '',
        model: LLM_MODEL || '',
        has_api_key: !!LLM_API_KEY
      });
    } catch (err) {
      return errorResponse(err.message, 500);
    }
  }

  // POST /publication-status — inspect recent draft/published entries without generating content
  if (url.pathname === '/publication-status' && request.method === 'POST') {
    try {
      const body = await request.json();
      if (!body.secret || body.secret !== SHARED_SECRET) return errorResponse('Unauthorized', 401);
      const token = await getAccessToken();
      const [drafts, published] = await Promise.all([listDrafts(token), listPublished(token)]);
      return jsonResponse({ status: 'ok', drafts, published });
    } catch (err) {
      return errorResponse(err.message, 500);
    }
  }

  // POST /source-status — inspect current source candidates without calling the LLM
  if (url.pathname === '/source-status' && request.method === 'POST') {
    try {
      const body = await request.json();
      if (!body.secret || body.secret !== SHARED_SECRET) return errorResponse('Unauthorized', 401);
      const [feedX, feedBlogs, rawHNStories, rawChinaStories] = await Promise.all([
        fetchJSON(FEED_X_URL),
        fetchJSON(FEED_BLOGS_URL),
        fetchHNStories(),
        fetchChinaAIStories()
      ]);
      const token = await getAccessToken();
      const usedIndex = buildUsedContentIndex(await listDraftReferences(token));
      const xBuilders = (feedX?.x || [])
        .map(builder => ({ ...builder, tweets: filterUsedStories(builder.tweets || [], usedIndex) }))
        .filter(builder => (builder.tweets || []).length > 0);
      const blogs = filterUsedStories(feedBlogs?.blogs || [], usedIndex);
      const hnStories = filterUsedStories(rawHNStories, usedIndex);
      const chinaStories = filterUsedStories(rawChinaStories, usedIndex);
      const totalTweets = xBuilders.reduce((s, a) => s + (a.tweets?.length || 0), 0);
      return jsonResponse({
        status: 'ok',
        stats: {
          hnStories: hnStories.length,
          chinaStories: chinaStories.length,
          xBuilders: xBuilders.length,
          totalTweets,
          blogPosts: blogs.length,
          filtered: {
            hnStories: Math.max(0, rawHNStories.length - hnStories.length),
            chinaStories: Math.max(0, rawChinaStories.length - chinaStories.length)
          }
        },
        chinaStories: chinaStories.slice(0, 12).map(item => ({
          title: item.title,
          source: item.source,
          category: item.category,
          url: item.url,
          keywordScore: item.keywordScore,
          reliabilityScore: chinaReliabilityScore(item)
        }))
      });
    } catch (err) {
      return errorResponse(err.message, 500);
    }
  }

  // POST /publish-existing — publish an existing draft without another LLM generation
  if (url.pathname === '/publish-existing' && request.method === 'POST') {
    try {
      const body = await request.json();
      if (!body.secret || body.secret !== SHARED_SECRET) return errorResponse('Unauthorized', 401);
      if (!body.media_id) return errorResponse('Missing media_id', 400);
      const token = await getAccessToken();
      const publishId = await publishDraft(token, body.media_id);
      return jsonResponse({ status: 'ok', media_id: body.media_id, publish_id: publishId });
    } catch (err) {
      return errorResponse(err.message, 500);
    }
  }

  // POST /setup-cover — upload cover image to WeChat material library
  if (url.pathname === '/setup-cover' && request.method === 'POST') {
    try {
      const body = await request.json();
      if (!body.secret || body.secret !== SHARED_SECRET) return errorResponse('Unauthorized', 401);

      // Generate a simple 900x383 cover image (blue gradient with text)
      const coverSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="383">
        <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#1a1a2e"/>
          <stop offset="100%" style="stop-color:#16213e"/>
        </linearGradient></defs>
        <rect width="900" height="383" fill="url(#g)"/>
        <text x="450" y="170" text-anchor="middle" font-family="Arial,sans-serif" font-size="42" font-weight="bold" fill="#e94560">AI Builders Digest</text>
        <text x="450" y="230" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" fill="#a0a0b0">每日AI建造者资讯</text>
        <line x1="300" y1="270" x2="600" y2="270" stroke="#e94560" stroke-width="2"/>
        <text x="450" y="310" text-anchor="middle" font-family="Arial,sans-serif" font-size="16" fill="#6c6c80">追踪建造者，而非网红</text>
      </svg>`;

      // Upload SVG directly (convert to PNG isn't possible in Workers without libs)
      // Use text/plain fallback: upload SVG as image, WeChat may reject it
      // Better approach: fetch a proper PNG from a URL
      const imageUrl = body.imageUrl || 'https://picsum.photos/900/383';
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) return errorResponse(`Failed to fetch cover image: ${imgRes.status}`, 500);

      const imgBuffer = await imgRes.arrayBuffer();
      const imgType = imgRes.headers.get('content-type') || 'image/png';
      const ext = imgType.includes('jpeg') || imgType.includes('jpg') ? 'jpg' : 'png';

      // Upload to WeChat as permanent material
      const token = await getAccessToken();
      const formData = new FormData();
      formData.append('media', new Blob([imgBuffer], { type: imgType }), `cover.${ext}`);
      formData.append('type', 'image');

      const uploadRes = await fetch(
        `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=image`,
        { method: 'POST', body: formData }
      );
      const uploadData = await uploadRes.json();

      if (uploadData.errcode) return errorResponse(`WeChat upload error [${uploadData.errcode}]: ${uploadData.errmsg}`, 500);

      return jsonResponse({
        status: 'ok',
        media_id: uploadData.media_id,
        url: uploadData.url,
        hint: 'Copy this media_id and update THUMB_MEDIA_ID secret'
      });
    } catch (err) {
      return errorResponse(err.message, 500);
    }
  }

  // POST /debug — check env vars without exposing values
  if (url.pathname === '/debug' && request.method === 'POST') {
    try {
      const body = await request.json();
      if (!body.secret || body.secret !== SHARED_SECRET) return errorResponse('Unauthorized', 401);
      return jsonResponse({
        hasAppId: !!env.WECHAT_APP_ID,
        hasAppSecret: !!env.WECHAT_APP_SECRET,
        hasThumb: !!env.THUMB_MEDIA_ID,
        hasSecret: !!env.SHARED_SECRET,
        hasLLM: !!env.LLM_API_KEY,
        hasLLMApiURL: !!env.LLM_API_URL,
        hasLLMModel: !!env.LLM_MODEL
      });
    } catch (err) {
      return errorResponse(err.message, 500);
    }
  }

  // GET /upload — show file upload form for cover images
  if (url.pathname === '/upload' && request.method === 'GET') {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Upload Cover</title>
<style>body{font-family:-apple-system,sans-serif;max-width:500px;margin:40px auto;padding:20px}
h2{color:#333}input,button{margin:10px 0;padding:10px}button{background:#07c160;color:#fff;border:none;border-radius:4px;font-size:16px;cursor:pointer}
#status{margin-top:16px;padding:12px;border-radius:4px;display:none}.ok{background:#e8f5e9;color:#2e7d32}.err{background:#ffebee;color:#c62828}</style></head><body>
<h2>上传封面图到微信公众号</h2>
<p>选择一张图片（PNG/JPG），上传后将返回 media_id。</p>
<input type="file" id="file" accept="image/*"><br>
<label>密钥：<input type="password" id="secret" placeholder="输入 SHARED_SECRET"></label><br>
<button onclick="upload()">上传到微信素材库</button>
<div id="status"></div>
<script>
function toBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>{const d=r.result;resolve(d.slice(d.indexOf(',')+1))};r.onerror=reject;r.readAsDataURL(file)})}
async function upload(){const s=document.getElementById('status');s.style.display='block';s.className='';s.textContent='上传中...';
const file=document.getElementById('file').files[0];if(!file){s.className='err';s.textContent='请选择文件';return}
const secret=document.getElementById('secret').value;if(!secret){s.className='err';s.textContent='请输入密钥';return}
try{const b64=await toBase64(file);
const r=await fetch('/upload-cover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret,filename:file.name,data:b64})});
const j=await r.json();if(j.status==='ok'){s.className='ok';s.textContent='成功！media_id: '+j.media_id}else{s.className='err';s.textContent='错误: '+j.message}}catch(e){s.className='err';s.textContent='错误: '+e.message}}
</script></body></html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
  }

  // POST /upload-cover — receive base64 image, upload to WeChat
  if (url.pathname === '/upload-cover' && request.method === 'POST') {
    try {
      const body = await request.json();
      if (!body.secret || body.secret !== SHARED_SECRET) return errorResponse('Unauthorized', 401);
      if (!body.data) return errorResponse('Missing image data', 400);
      const buf = Uint8Array.from(atob(body.data), c => c.charCodeAt(0));
      const ext = (body.filename || 'cover.png').endsWith('.jpg') ? 'jpg' : 'png';
      const mime = ext === 'jpg' ? 'image/jpeg' : 'image/png';
      const token = await getAccessToken();
      const fd = new FormData();
      fd.append('media', new Blob([buf], { type: mime }), `cover.${ext}`);
      fd.append('type', 'image');
      const r = await fetch(`https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=image`, { method: 'POST', body: fd });
      const d = await r.json();
      if (d.errcode) return errorResponse(`WeChat error [${d.errcode}]: ${d.errmsg}`, 500);
      return jsonResponse({ status: 'ok', media_id: d.media_id, url: d.url });
    } catch (err) {
      return errorResponse(err.message, 500);
    }
  }

  // Health check
  if (url.pathname === '/' || url.pathname === '/health') {
    return jsonResponse({ status: 'ok', message: 'WeChat OA Proxy running' });
  }

  return errorResponse('Not found', 404);
}

export default { fetch: handleRequest, scheduled };
