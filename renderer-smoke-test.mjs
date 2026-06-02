import assert from 'node:assert/strict';
import { markdownToHTML, removeEmptySections } from './article-renderer.js';

const markdown = `【今日头条】

第一行
第二行包含 <script>alert('x')</script> 与 **重点**。

[危险链接](javascript:alert)

【今日速览】

**1. 快讯标题**

内容说明。

[来源](https://example.com/story)

[Aaron Levie](https://x.com/levie/status/123)

【空板块】

暂无`;

const html = markdownToHTML(removeEmptySections(markdown));

assert.match(html, /LEAD STORY/);
assert.match(html, /QUICK READ/);
assert.match(html, /line-height:26px/);
assert.match(html, /line-height:34px/);
assert.match(html, /background-color:#f3f7fc/);
assert.match(html, /第一行<br>第二行包含/);
assert.match(html, /&lt;script&gt;/);
assert.doesNotMatch(html, /href="javascript:/);
assert.match(html, /https:\/\/example\.com\/story/);
assert.match(html, /来源：<a href="https:\/\/example\.com\/story"/);
assert.doesNotMatch(html, /来源：\（/);
assert.doesNotMatch(html, /来源账号 \/ 发布方/);
assert.doesNotMatch(html, /参考网址/);
assert.doesNotMatch(html, /空板块/);

console.log('renderer smoke test passed');
