/* ============================================================
   노션 → 티스토리 변환기  |  server.js
   Node 18+ (내장 fetch 사용)
   ============================================================ */

const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const NOTION_API = 'https://api.notion.com/v1';

/* ── Cloudinary 이미지 업로드 ── */
async function uploadToCloudinary(imageUrl, cloudName, apiKey, apiSecret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash('sha1').update(toSign).digest('hex');

  const body = new URLSearchParams();
  body.append('file', imageUrl);
  body.append('timestamp', String(timestamp));
  body.append('api_key', apiKey);
  body.append('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Cloudinary 오류 (${res.status})`);
  }
  const data = await res.json();
  return data.secure_url;
}

/* ── 블록 트리에서 이미지 URL 수집 ── */
function collectImageUrls(blocks) {
  const items = [];
  for (const block of blocks) {
    if (block.type === 'image') {
      const d = block.image || {};
      const url = d.type === 'external' ? d.external?.url : d.file?.url;
      if (url) items.push(url);
    }
    if (block._children) items.push(...collectImageUrls(block._children));
  }
  return items;
}
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

      // 노션 형광펜(배경색) 및 글자색 처리
      if (ann.color && ann.color !== 'default') {
        const colorMap = {
          yellow_background:  '#fff9c4',
          green_background:   '#d4edda',
          blue_background:    '#d0e8ff',
          red_background:     '#ffd6d6',
          orange_background:  '#ffe0b2',
          purple_background:  '#ead5f9',
          pink_background:    '#fce4ec',
          gray_background:    '#e0e0e0',
          brown_background:   '#efebe9',
        };
        if (ann.color.endsWith('_background')) {
          const bg = colorMap[ann.color] || '#ffff00';
          text = `<span style="background-color:${bg};">${text}</span>`;
        } else {
          const fgMap = {
            yellow: '#f5c400', green: '#0f7b0f', blue: '#0055cc',
            red: '#cc0000', orange: '#d9730d', purple: '#6940a5',
            pink: '#e03e7c', gray: '#9b9b9b', brown: '#64473a',
          };
          const fg = fgMap[ann.color] || ann.color;
          text = `<span style="color:${fg};">${text}</span>`;
        }
      }
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
      html += `<ul style="list-style-type:disc;" data-ke-list-type="disc">`;
      while (i < blocks.length && blocks[i].type === 'bulleted_list_item') {
        const b = blocks[i];
        const bd = b.bulleted_list_item || {};
        const inner = richText(bd.rich_text);
        // 중첩 리스트: circle bullet + 색상 구분
        const nested = b._children ? `<ul style="list-style-type:circle;padding-left:1.5em;margin:0.2em 0;color:#444;font-size:15px;">${
          b._children.filter(c => c.type === 'bulleted_list_item').map(c => {
            const cd = c.bulleted_list_item || {};
            const cInner = richText(cd.rich_text);
            const cNested = c._children ? blocksToHtml(c._children, opts) : '';
            return `<li style="margin:0.15em 0;">${cInner}${cNested}</li>`;
          }).join('')
        }</ul>${blocksToHtml(b._children.filter(c => c.type !== 'bulleted_list_item'), opts)}` : '';
        html += `<li style="margin:0.3em 0;">${inner}${nested}</li>`;
        i++;
      }
      html += '</ul>';
      continue;
    }

    // 연속 numbered_list_item
    if (type === 'numbered_list_item') {
      html += `<ol style="list-style-type:decimal;" data-ke-list-type="decimal">`;
      while (i < blocks.length && blocks[i].type === 'numbered_list_item') {
        const b = blocks[i];
        const bd = b.numbered_list_item || {};
        const inner = richText(bd.rich_text);
        // 중첩 리스트: lower-alpha + 색상 구분
        const nested = b._children ? `<ol style="list-style-type:lower-alpha;padding-left:1.5em;margin:0.2em 0;color:#444;font-size:15px;">${
          b._children.filter(c => c.type === 'numbered_list_item').map(c => {
            const cd = c.numbered_list_item || {};
            const cInner = richText(cd.rich_text);
            const cNested = c._children ? blocksToHtml(c._children, opts) : '';
            return `<li style="margin:0.15em 0;">${cInner}${cNested}</li>`;
          }).join('')
        }</ol>${blocksToHtml(b._children.filter(c => c.type !== 'numbered_list_item'), opts)}` : '';
        html += `<li style="margin:0.3em 0;">${inner}${nested}</li>`;
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
        const text = richText(data.rich_text);
        html += `<h2 data-ke-size="size26" style="padding-left:0.6em;border-left:4px solid #003876;"><span style="font-family: ${HEADING_FONT};"><b>${text}</b></span></h2>`;
        break;
      }
      case 'heading_2': {
        const text = richText(data.rich_text);
        html += `<h3 data-ke-size="size23" style="padding-left:0.5em;border-left:3px solid #003876;"><span style="font-family: ${HEADING_FONT};"><b>${text}</b></span></h3>`;
        break;
      }
      case 'heading_3': {
        const text = richText(data.rich_text);
        html += `<h4 data-ke-size="size20"><span style="font-family: ${HEADING_FONT};"><b>${text}</b></span></h4>`;
        break;
      }
      case 'quote': {
        const text = richText(data.rich_text);
        const children = block._children ? blocksToHtml(block._children, opts) : '';
        html += `<blockquote data-ke-style="style2" style="margin:1em 0;padding:0.8em 1.2em;border-left:4px solid #aaa;background:#f9f9f9;color:#555;"><p data-ke-size="size16" style="margin:0 0 ${children ? '0.5em' : '0'};">${text}</p>${children}</blockquote>`;
        break;
      }
      case 'callout': {
        const icon = data.icon?.emoji ? data.icon.emoji + ' ' : '💡 ';
        const text = richText(data.rich_text);
        const children = block._children ? blocksToHtml(block._children, opts) : '';
        // callout 블록 배경색 (노션 color 속성 반영)
        const calloutColorMap = {
          yellow_background: '#fffbe6', orange_background: '#fff3e0',
          green_background:  '#f0faf0', blue_background:   '#eef4ff',
          red_background:    '#fff0f0', purple_background: '#f5f0ff',
          pink_background:   '#fff0f8', gray_background:   '#f5f5f5',
          brown_background:  '#fdf6f0',
          yellow: '#fffbe6', orange: '#fff3e0', green: '#f0faf0',
          blue: '#eef4ff', red: '#fff0f0', purple: '#f5f0ff',
          pink: '#fff0f8', gray: '#f5f5f5', brown: '#fdf6f0',
        };
        const bg = calloutColorMap[data.color] || '#eef4ff';
        html += `<div style="display:flex;align-items:flex-start;gap:0.6em;background:${bg};border:1px solid #c8d8f0;border-radius:6px;padding:0.9em 1.1em;margin:1em 0;"><span style="font-size:1.2em;line-height:1.6;flex-shrink:0;">${icon}</span><div style="flex:1;"><p data-ke-size="size16" style="margin:0;">${text}</p>${children}</div></div>`;
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
        const finalUrl = (opts.imageUrlMap && opts.imageUrlMap[url]) || url;
        const cap = data.caption ? richText(data.caption) : '';
        html += `<p data-ke-size="size16" style="text-align:center;"><img src="${finalUrl}" style="max-width:100%;height:auto;" /></p>`;
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

  const { pageId, options = {}, cloudinary } = req.body;
  if (!pageId) return res.status(400).json({ error: 'pageId가 필요합니다.' });

  try {
    const opts = {
      katex:  !!options.katex,
      images: options.images !== false,
      meta:   !!options.meta,
      toc:    !!options.toc,
      imageUrlMap: {},
    };

    // 블록 재귀 fetch
    _mathId = 0;
    const blocks = await fetchBlocks(token, pageId);

    // Cloudinary 이미지 업로드 (credentials 있을 때만)
    if (cloudinary?.cloudName && cloudinary?.apiKey && cloudinary?.apiSecret && opts.images !== false) {
      const urls = [...new Set(collectImageUrls(blocks))];
      let uploaded = 0;
      for (const url of urls) {
        try {
          opts.imageUrlMap[url] = await uploadToCloudinary(url, cloudinary.cloudName, cloudinary.apiKey, cloudinary.apiSecret);
          uploaded++;
        } catch (e) {
          console.error(`[Cloudinary] 업로드 실패 (${url}):`, e.message);
        }
      }
      console.log(`[Cloudinary] ${uploaded}/${urls.length} 이미지 업로드 완료`);
    }

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
