const BODY_FONT = `font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif`;
const DISPLAY_FONT = `font-family:"Songti SC","STSong","Noto Serif CJK SC","Source Han Serif SC",serif`;
const META_FONT = `font-family:"Helvetica Neue","PingFang SC","Microsoft YaHei",sans-serif`;

const COLORS = {
  ink: '#162437',
  text: '#263548',
  muted: '#758298',
  blue: '#1766c2',
  paleBlue: '#f3f7fc',
  line: '#e5ecf4',
  warm: '#f8f7f4'
};

const SECTION_META = {
  '今日头条': { index: '01', english: 'LEAD STORY' },
  '今日速览': { index: '02', english: 'QUICK READ' },
  '深度解读': { index: '03', english: 'ANALYSIS' },
  '今日趣闻': { index: '04', english: 'CLOSING NOTE' }
};

function renderSpace(height) {
  return `<p style="margin:0;line-height:${height}px;font-size:1px;color:#fff;">&nbsp;</p>`;
}

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeLinkURL(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch (_) {
    return null;
  }
}

function renderInline(value) {
  const input = String(value);
  const tokenPattern = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|\*(.+?)\*/g;
  let output = '';
  let cursor = 0;
  let match;

  while ((match = tokenPattern.exec(input)) !== null) {
    output += escapeHTML(input.slice(cursor, match.index));
    if (match[1] !== undefined) {
      const url = safeLinkURL(match[2]);
      output += url
        ? `<a href="${escapeHTML(url)}" style="color:${COLORS.blue};text-decoration:none;border-bottom:1px solid #bed4ee">${escapeHTML(match[1])}</a>`
        : escapeHTML(match[0]);
    } else if (match[3] !== undefined) {
      output += `<strong style="font-weight:600;color:${COLORS.ink}">${escapeHTML(match[3])}</strong>`;
    } else {
      output += `<em style="font-style:normal;color:${COLORS.blue}">${escapeHTML(match[4])}</em>`;
    }
    cursor = tokenPattern.lastIndex;
  }

  return output + escapeHTML(input.slice(cursor));
}

function renderMasthead() {
  return `<section style="margin:0 20px 30px 20px;padding:0 0 18px 0;border-bottom:1px solid ${COLORS.line};${META_FONT}">
    <span style="display:inline-block;margin-right:9px;padding:4px 9px 3px;background-color:${COLORS.ink};color:#fff;font-size:10px;font-weight:700;letter-spacing:1.4px;line-height:1.3">DINGDONG.AI</span>
    <span style="color:${COLORS.muted};font-size:11px;letter-spacing:1.8px;line-height:1.5">INTELLIGENCE BRIEF</span>
  </section>`;
}

function renderSectionHeader(title, isFirstSection) {
  const clean = title.replace(/^【|】$/g, '').trim();
  const meta = SECTION_META[clean] || { index: '', english: 'FEATURE' };
  const number = meta.index
    ? `<span style="color:${COLORS.blue};font-size:12px;font-weight:700;letter-spacing:1px;margin-right:10px">${meta.index}</span>`
    : '';
  const before = isFirstSection ? renderSpace(18) : renderSpace(34);
  return `${before}<section style="margin:0 20px;${META_FONT}">
    <p style="margin:0 0 9px 0;color:${COLORS.muted};font-size:10px;font-weight:600;letter-spacing:2px;line-height:1.4">${number}${meta.english}</p>
    <h2 style="margin:0;color:${COLORS.ink};font-size:22px;font-weight:700;letter-spacing:0.5px;line-height:1.35;${DISPLAY_FONT}">${escapeHTML(clean)}</h2>
    <p style="margin:12px 0 0 0;line-height:2px;font-size:1px"><span style="display:inline-block;width:32px;height:2px;background-color:${COLORS.blue};">&nbsp;</span></p>
  </section>${renderSpace(26)}`;
}

function renderBriefTitle(number, title) {
  return `<h3 style="margin:24px 20px 10px 20px;color:${COLORS.ink};font-size:17px;font-weight:600;line-height:1.75;${BODY_FONT}">
    <span style="display:inline-block;margin:0 12px 0 0;padding:3px 8px 2px 8px;background-color:${COLORS.blue};color:#fff;font-size:12px;font-weight:700;line-height:1.4;vertical-align:2px">${escapeHTML(number)}</span>${renderInline(title)}
  </h3>`;
}

function renderParagraph(text, isLead) {
  const content = String(text).split('\n').map(renderInline).join('<br>');
  if (isLead) {
    return `<section style="margin:0 20px 22px 20px;padding:18px 17px 18px 18px;background-color:${COLORS.paleBlue};border-left:3px solid ${COLORS.blue};${BODY_FONT}">
      <p style="margin:0;color:${COLORS.ink};font-size:16px;font-weight:500;letter-spacing:0.1px;line-height:2;text-align:left">${content}</p>
    </section>`;
  }
  return `<p style="margin:0 20px 16px 20px;color:${COLORS.text};font-size:16px;font-weight:400;letter-spacing:0.1px;line-height:2;text-align:left;${BODY_FONT}">${content}</p>`;
}

function renderSource(text, url) {
  const safe = safeLinkURL(url);
  if (!safe) return renderParagraph(`[${text}](${url})`, false);
  return `<section style="margin:8px 20px 22px 20px;padding:8px 11px;background-color:#f6f8fb;border-left:2px solid #d8e3f1;${META_FONT}">
    <p style="margin:0;color:${COLORS.muted};font-size:12px;line-height:1.8;word-break:break-all;">来源：<a href="${escapeHTML(safe)}" style="color:${COLORS.blue};text-decoration:none">${escapeHTML(safe)}</a></p>
  </section>`;
}

function renderQuote(text) {
  return `<section style="margin:24px 20px;padding:18px 18px;background-color:${COLORS.warm};border-left:3px solid #e7e1d7;color:${COLORS.ink};font-size:16px;font-weight:500;line-height:2;${DISPLAY_FONT}">“${renderInline(text)}”</section>`;
}

function renderDivider() {
  return `${renderSpace(14)}<section style="margin:0 20px;border-top:1px solid ${COLORS.line};line-height:1px;font-size:1px">&nbsp;</section>`;
}

function renderGenericHeading(level, text) {
  const size = level === 2 ? '20px' : '17px';
  return `<h${level} style="margin:30px 20px 14px 20px;color:${COLORS.ink};font-size:${size};font-weight:600;line-height:1.55;${DISPLAY_FONT}">${renderInline(text)}</h${level}>`;
}

export function markdownToHTML(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const output = [renderMasthead()];
  let paragraph = [];
  let section = '';
  let hasLeadParagraph = false;
  let sectionCount = 0;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const value = paragraph.join('\n').trim();
    if (value) {
      const isLead = section === '今日头条' && !hasLeadParagraph;
      output.push(renderParagraph(value, isLead));
      if (isLead) hasLeadParagraph = true;
    }
    paragraph = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    let match;
    if (!line) {
      flushParagraph();
      continue;
    }
    if ((match = line.match(/^(?:##\s*)?【(.+)】\s*$/))) {
      flushParagraph();
      section = match[1].trim();
      output.push(renderSectionHeader(section, sectionCount === 0));
      sectionCount += 1;
      continue;
    }
    if ((match = line.match(/^\*\*(\d+)[.、]\s*(.+)\*\*$/))) {
      flushParagraph();
      output.push(renderBriefTitle(match[1].padStart(2, '0'), match[2]));
      continue;
    }
    if ((match = line.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/))) {
      flushParagraph();
      output.push(renderSource(match[1], match[2]));
      continue;
    }
    if ((match = line.match(/^###\s+(.+)$/))) {
      flushParagraph();
      output.push(renderGenericHeading(3, match[1]));
      continue;
    }
    if ((match = line.match(/^##\s+(.+)$/))) {
      flushParagraph();
      output.push(renderGenericHeading(2, match[1]));
      continue;
    }
    if ((match = line.match(/^>\s+(.+)$/))) {
      flushParagraph();
      output.push(renderQuote(match[1]));
      continue;
    }
    if (/^---+$/.test(line)) {
      flushParagraph();
      output.push(renderDivider());
      continue;
    }
    paragraph.push(line);
  }

  flushParagraph();
  return `<section style="margin:0;padding:22px 0 34px 0;background-color:#fff;color:${COLORS.text};${BODY_FONT}">${output.join('\n')}</section>`;
}

export function removeEmptySections(markdown) {
  const normalized = String(markdown || '').replace(/^【(.+)】\s*$/gm, '## 【$1】');
  const parts = normalized.split(/^(?=## )/m);
  const keep = [parts[0]];
  const placeholder = /^(今日|目前|暂时|这里)?(暂无|没有|无)(相关|融资|更多)?[^。\n]{0,10}[。]?\s*$/m;
  for (let i = 1; i < parts.length; i++) {
    const body = parts[i].replace(/^## .+\n+/, '').trim();
    if (!body || placeholder.test(body)) continue;
    keep.push(parts[i]);
  }
  return keep.join('\n');
}
