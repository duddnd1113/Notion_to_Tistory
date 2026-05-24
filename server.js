/* ============================================================
   노션 → 티스토리 변환기  |  server.js
   Node 18+ (내장 fetch 사용)
   ============================================================ */

const express = require('express');
const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/* ── Notion API 공통 fetch ── */
async function notionFetch(token, path, options = {}) {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.message || `Notion API 오류 (${res.status})`);
  }
  return res.json();
}

/* ── 재귀 블록 fetch (페이지네이션 포함) ── */
async function fetchBlocks(token, blockId) {
  let results = [];
  let cursor = undefined;

  do {
    const params = new URLSearchParams({ page_size: '100' });
    if (cursor) params.set('start_cursor', cursor);
    const data = await notionFetch(token, `/blocks/${blockId}/children?${params}`);
    results = results.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  // 재귀: has_children이 true이고 child_page/child_database가 아닌 경우
  for (const block of results) {
    if (
      block.has_children &&
      block.type !== 'child_page' &&
      block.type !== 'child_database'
    ) {
      block._children = await fetchBlocks(token, block.id);
    }
  }

  return results;
}

const HEADING_FONT = `AppleSDGothicNeo-Regular, 'Malgun Gothic', '맑은 고딕', dotum, 돋움, sans-serif`;

/* ── rich_text 배열 → Tistory HTML ── */
function richText(rt) {
  if (!rt || !rt.length) return '';
  return rt.map(span => {
    // 인라인 수식
    if (span.type === 'equation') {
      const expr = span.equation?.expression || span.plain_text || '';
      return `$${expr}$`;
    }

    let text = span.plain_text || '';
    // & < > 는 HTML 엔티티로
    text = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const ann = span.annotations || {};
    if (ann.code) {
      text = `<code>${text}</code>`;
    } else {
      if (ann.bold)          text = `<b>${text}</b>`;
      if (ann.italic)        text = `<i>${text}</i>`;
      if (ann.strikethrough) text = `<s>${text}</s>`;
      if (ann.underline)     text = `<u>${text}</u>`;
    }

    const href = span.href || span.text?.link?.url;
    if (href) text = `<a href="${href}">${text}</a>`;
    return text;
  }).join('');
}

/* ── 수식 블록 → Tistory data-ke-type="html" ── */
let _mathId = 0;
function mathBlock(expr) {
  _mathId++;
  return `<p data-ke-size="size16" style="text-align:center;">$$${expr}$$</p>`;
}

/* ── 블록 배열 → Tistory HTML ── */
function blocksToHtml(blocks, opts = {}) {
  let html = '';
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];
    const type = block.type;
    const data = block[type] || {};

    // 연속 bulleted_list_item
    if (type === 'bulleted_list_item') {
      html += `<ul style="list-style-type: disc;" data-ke-list-type="disc">`;
      while (i < blocks.length && blocks[i].type === 'bulleted_list_item') {
        const b = blocks[i];
        const bd = b.bulleted_list_item || {};
        const inner = richText(bd.rich_text);
        const nested = b._children ? blocksToHtml(b._children, opts) : '';
        html += `<li>${inner}${nested}</li>`;
        i++;
      }
      html += '</ul>';
      continue;
    }

    // 연속 numbered_list_item
    if (type === 'numbered_list_item') {
      html += `<ol style="list-style-type: decimal;" data-ke-list-type="decimal">`;
      while (i < blocks.length && blocks[i].type === 'numbered_list_item') {
        const b = blocks[i];
        const bd = b.numbered_list_item || {};
        const inner = richText(bd.rich_text);
        const nested = b._children ? blocksToHtml(b._children, opts) : '';
        html += `<li>${inner}${nested}</li>`;
        i++;
      }
      html += '</ol>';
      continue;
    }

    switch (type) {
      case 'paragraph': {
        const text = richText(data.rich_text);
        html += `<p data-ke-size="size16">${text || '&nbsp;'}</p>`;
        break;
      }
      case 'heading_1': {
        // 노션 # → Tistory h2 size26
        const text = richText(data.rich_text);
        html += `<h2 data-ke-size="size26"><span style="font-family: ${HEADING_FONT};"><b>${text}</b></span></h2>`;
        break;
      }
      case 'heading_2': {
        // 노션 ## → Tistory h3 size23
        const text = richText(data.rich_text);
        html += `<h3 data-ke-size="size23"><span style="font-family: ${HEADING_FONT};"><b>${text}</b></span></h3>`;
        break;
      }
      case 'heading_3': {
        // 노션 ### → Tistory h4 size20
        const text = richText(data.rich_text);
        html += `<h4 data-ke-size="size20"><span style="font-family: ${HEADING_FONT};"><b>${text}</b></span></h4>`;
        break;
      }
      case 'quote': {
        const text = richText(data.rich_text);
        html += `<blockquote data-ke-style="style2"><p data-ke-size="size16">${text}</p></blockquote>`;
        break;
      }
      case 'callout': {
        const icon = data.icon?.emoji ? data.icon.emoji + ' ' : '';
        const text = richText(data.rich_text);
        html += `<blockquote data-ke-style="style2"><p data-ke-size="size16">${icon}${text}</p></blockquote>`;
        break;
      }
      case 'divider': {
        html += `<hr contenteditable="false" data-ke-type="horizontalRule" data-ke-style="style6" />`;
        break;
      }
      case 'code': {
        const lang = data.language || '';
        const code = (data.rich_text || []).map(s => s.plain_text).join('');
        const escaped = code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        html += `<div style="overflow-x:auto;max-width:100%;"><pre data-ke-language="${lang}" data-ke-type="codeBlock" style="white-space:pre-wrap;word-break:break-all;"><code>${escaped}</code></pre></div>`;
        break;
      }
      case 'toggle': {
        const summary = richText(data.rich_text);
        const inner = block._children ? blocksToHtml(block._children, opts) : '';
        html += `<details><summary data-ke-size="size16">${summary}</summary>${inner}</details>`;
        break;
      }
      case 'to_do': {
        const checked = data.checked ? ' checked' : '';
        const text = richText(data.rich_text);
        html += `<p data-ke-size="size16"><input type="checkbox" disabled${checked}> ${text}</p>`;
        break;
      }
      case 'image': {
        if (opts.images === false) break;
        const url = data.type === 'external' ? data.external?.url : data.file?.url;
        if (!url) break;
        const cap = data.caption ? richText(data.caption) : '';
        html += `<p data-ke-size="size16" style="text-align:center;"><img src="${url}" style="max-width:100%;height:auto;" /></p>`;
        if (cap) html += `<p data-ke-size="size16" style="text-align:center;color:#666;font-size:13px;">${cap}</p>`;
        break;
      }
      case 'equation': {
        // 블록 수식 → Tistory HTML 블록 (MathJax로 렌더링됨)
        html += mathBlock(data.expression || '');
        break;
      }
      case 'table': {
        const rows = block._children || [];
        html += `<div style="overflow-x:auto;max-width:100%;"><table style="border-collapse:collapse;min-width:100%;">`;
        rows.forEach((row, ri) => {
          const cells = row.table_row?.cells || [];
          html += '<tr>';
          cells.forEach(cell => {
            const tag = (ri === 0 && block[type]?.has_column_header) ? 'th' : 'td';
            const style = tag === 'th'
              ? 'style="border:1px solid #ccc;padding:6px 10px;background:#f5f5f5;font-weight:bold;white-space:nowrap;"'
              : 'style="border:1px solid #ccc;padding:6px 10px;"';
            html += `<${tag} ${style}>${richText(cell)}</${tag}>`;
          });
          html += '</tr>';
        });
        html += '</table></div>';
        break;
      }
      case 'bookmark': {
        const url = data.url || '';
        html += `<p data-ke-size="size16"><a href="${url}">${url}</a></p>`;
        break;
      }
      case 'child_page':
      case 'child_database':
        break;
      default:
        break;
    }

    i++;
  }

  return html;
}

/* ── TOC 생성 (Tistory 스타일) ── */
function buildToc(bodyHtml) {
  const headings = [];
  const re = /<h([234])[^>]*>([\s\S]*?)<\/h[234]>/gi;
  let match;
  while ((match = re.exec(bodyHtml)) !== null) {
    const level = match[1];
    const text = match[2].replace(/<[^>]+>/g, '');
    headings.push({ level, text });
  }
  if (!headings.length) return '';

  let toc = `<div data-ke-type="html"><ul>`;
  headings.forEach(h => {
    const indent = h.level === '3' ? 'style="margin-left:1rem"' : h.level === '4' ? 'style="margin-left:2rem"' : '';
    toc += `<li ${indent}>${h.text}</li>`;
  });
  toc += '</ul></div>';
  return toc;
}

/* ── 엔드포인트 1: 워크스페이스 검색 ── */
app.post('/api/workspace', async (req, res) => {
  const token = req.headers['x-notion-token'];
  if (!token) return res.status(401).json({ error: 'x-notion-token 헤더가 필요합니다.' });

  try {
    const data = await notionFetch(token, '/search', {
      method: 'POST',
      body: JSON.stringify({ page_size: 100, sort: { direction: 'ascending', timestamp: 'last_edited_time' } }),
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── 엔드포인트 2: 하위 항목 목록 (페이지 자식 또는 데이터베이스 쿼리 자동 판별) ── */
app.get('/api/children/:id', async (req, res) => {
  const token = req.headers['x-notion-token'];
  if (!token) return res.status(401).json({ error: 'x-notion-token 헤더가 필요합니다.' });

  const { id } = req.params;
  const { type } = req.query; // 'database' or 'page'

  try {
    if (type === 'database') {
      // 데이터베이스 내부 페이지 목록
      const data = await notionFetch(token, `/databases/${id}/query`, {
        method: 'POST',
        body: JSON.stringify({ page_size: 100, sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] }),
      });
      res.json(data);
    } else {
      // 페이지 하위 블록 목록 (child_page, child_database만 의미 있음)
      const data = await notionFetch(token, `/blocks/${id}/children?page_size=100`);
      res.json(data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── 엔드포인트 3: 페이지 메타 조회 ── */
app.get('/api/pages/:id', async (req, res) => {
  const token = req.headers['x-notion-token'];
  if (!token) return res.status(401).json({ error: 'x-notion-token 헤더가 필요합니다.' });

  try {
    const data = await notionFetch(token, `/pages/${req.params.id}`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── 엔드포인트 4: 변환 ── */
app.post('/api/convert', async (req, res) => {
  const token = req.headers['x-notion-token'];
  if (!token) return res.status(401).json({ error: 'x-notion-token 헤더가 필요합니다.' });

  const { pageId, options = {} } = req.body;
  if (!pageId) return res.status(400).json({ error: 'pageId가 필요합니다.' });

  try {
    const opts = {
      katex:  !!options.katex,
      images: options.images !== false,
      meta:   !!options.meta,
      toc:    !!options.toc,
    };

    // 블록 재귀 fetch
    _mathId = 0;
    const blocks = await fetchBlocks(token, pageId);
    const bodyHtml = blocksToHtml(blocks, opts);

    // TOC
    let toc = '';
    if (opts.toc) toc = buildToc(bodyHtml);

    // 메타 (페이지 속성 → 상단 정보 블록)
    let meta = '';
    if (opts.meta) {
      try {
        const page = await notionFetch(token, `/pages/${pageId}`);
        const props = page.properties || {};
        const items = [];
        for (const [key, val] of Object.entries(props)) {
          let v = '';
          if (val.type === 'title') v = (val.title || []).map(t => t.plain_text).join('');
          else if (val.type === 'rich_text') v = (val.rich_text || []).map(t => t.plain_text).join('');
          else if (val.type === 'select') v = val.select?.name || '';
          else if (val.type === 'multi_select') v = (val.multi_select || []).map(s => s.name).join(', ');
          else if (val.type === 'date') v = val.date?.start || '';
          else if (val.type === 'number') v = String(val.number ?? '');
          if (v) items.push(`<b>${key}</b>: ${v}`);
        }
        if (items.length) {
          meta = `<p data-ke-size="size16">${items.join(' &nbsp;|&nbsp; ')}</p>\n`;
        }
      } catch (_) {}
    }

    const html = `${toc}${meta}${bodyHtml}<div style="clear:both;"></div>`;
    res.json({ html });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(3000, () => {
  console.log('서버 실행 중: http://localhost:3000');
});
