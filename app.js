/* ============================================================
   노션 → 티스토리 변환기  |  app.js
   ============================================================
   동작 방식:
   1. Anthropic API (claude-sonnet-4-20250514) 에 MCP 서버(Notion)를 연결
   2. 노션 페이지를 검색하고 내용을 가져옴
   3. 티스토리용 HTML로 변환 후 클립보드에 복사
   ============================================================ */

/* ── 상태 ── */
let selectedPage = null;
let convertedHTML = '';

/* ── 초기화: 저장된 키 불러오기 ── */
window.addEventListener('DOMContentLoaded', () => {
  const ak = localStorage.getItem('anthropicKey');
  const nt = localStorage.getItem('notionToken');
  if (ak) document.getElementById('anthropicKey').value = ak;
  if (nt) document.getElementById('notionToken').value = nt;
});

/* ── 키 저장 ── */
function saveKeys() {
  const ak = document.getElementById('anthropicKey').value.trim();
  const nt = document.getElementById('notionToken').value.trim();
  if (!ak || !nt) { alert('두 키를 모두 입력해주세요.'); return; }
  localStorage.setItem('anthropicKey', ak);
  localStorage.setItem('notionToken', nt);
  showToast('키가 저장되었습니다 ✓');
}

/* ── 비밀번호 표시 토글 ── */
function toggleVis(id) {
  const el = document.getElementById(id);
  el.type = el.type === 'password' ? 'text' : 'password';
}

/* ── 상태 메시지 표시 ── */
function setStatus(id, msg, type = '') {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = 'status' + (type ? ' ' + type : '');
  el.classList.remove('hidden');
}

/* ── Anthropic API 공통 호출 ── */
async function callClaude({ system, userMsg, useNotionMCP = false }) {
  const apiKey = localStorage.getItem('anthropicKey');
  const notionToken = localStorage.getItem('notionToken');

  if (!apiKey) throw new Error('Anthropic API 키를 먼저 저장해주세요.');
  if (useNotionMCP && !notionToken) throw new Error('Notion 토큰을 먼저 저장해주세요.');

  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8000,
    system,
    messages: [{ role: 'user', content: userMsg }],
  };

  if (useNotionMCP) {
    body.mcp_servers = [{
      type: 'url',
      url: 'https://mcp.notion.com/mcp',
      name: 'notion-mcp',
      authorization_token: notionToken,
    }];
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'mcp-client-2025-04-04',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API 오류 (${res.status})`);
  }

  const data = await res.json();
  return data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
}

/* ── 페이지 검색 ── */
async function searchPages() {
  const q = document.getElementById('searchInput').value.trim();
  if (!q) return;

  const btn = document.getElementById('searchBtn');
  btn.disabled = true;
  setStatus('searchStatus', '노션을 검색하는 중...', 'loading');
  document.getElementById('pageList').classList.add('hidden');

  try {
    const text = await callClaude({
      useNotionMCP: true,
      system: `You are a Notion search assistant. Search the user's Notion workspace for paper review pages matching their query.
Return ONLY a JSON array, no markdown fences, no explanation. Format:
[{"id":"page-id","title":"Page Title","conference":"ICLR","year":2024,"status":"Completed","tags":["OOD","CV"]}]
If nothing found, return [].`,
      userMsg: `Search Notion for paper review pages matching: "${q}"`,
    });

    let pages = [];
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      const s = clean.indexOf('['), e = clean.lastIndexOf(']');
      if (s >= 0 && e >= 0) pages = JSON.parse(clean.slice(s, e + 1));
    } catch (_) { pages = []; }

    if (!pages.length) {
      setStatus('searchStatus', '검색 결과가 없어요. 다른 키워드로 시도해보세요.', 'error');
    } else {
      setStatus('searchStatus', `${pages.length}개 페이지를 찾았어요. 변환할 페이지를 선택하세요.`, 'success');
      renderPageList(pages);
    }
  } catch (e) {
    setStatus('searchStatus', '오류: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ── 페이지 목록 렌더 ── */
function renderPageList(pages) {
  const list = document.getElementById('pageList');
  list.innerHTML = '';
  pages.forEach(p => {
    const item = document.createElement('div');
    item.className = 'page-item';
    item.innerHTML = `
      <span class="page-item-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </span>
      <span class="page-item-body">
        <span class="page-item-title">${escHtml(p.title)}</span>
        <span class="page-item-meta">${[p.conference, p.year, p.status].filter(Boolean).join(' · ')}</span>
      </span>
      ${p.conference ? `<span class="badge">${escHtml(p.conference)}</span>` : ''}
    `;
    item.addEventListener('click', () => selectPage(p, item));
    list.appendChild(item);
  });
  list.classList.remove('hidden');
}

/* ── 페이지 선택 ── */
function selectPage(page, el) {
  document.querySelectorAll('.page-item').forEach(i => i.classList.remove('selected'));
  el.classList.add('selected');
  selectedPage = page;
  document.getElementById('convertBtn').disabled = false;
}

/* ── 변환 ── */
async function convertPage() {
  if (!selectedPage) return;

  const btn = document.getElementById('convertBtn');
  btn.disabled = true;
  setStatus('convertStatus', '노션에서 페이지 내용을 가져오는 중...', 'loading');

  const useKatex  = document.getElementById('optKatex').checked;
  const useImages = document.getElementById('optImages').checked;
  const useMeta   = document.getElementById('optMeta').checked;
  const useToc    = document.getElementById('optToc').checked;

  try {
    const html = await callClaude({
      useNotionMCP: true,
      system: buildConvertSystemPrompt({ useKatex, useImages, useMeta, useToc }),
      userMsg: `Fetch Notion page id="${selectedPage.id}" titled "${selectedPage.title}" and convert it to Tistory HTML.`,
    });

    const cleaned = html.replace(/^```html\n?/, '').replace(/\n?```$/, '').trim();

    if (!cleaned || cleaned.length < 100) {
      setStatus('convertStatus', '변환 결과가 너무 짧아요. 다시 시도해주세요.', 'error');
      btn.disabled = false;
      return;
    }

    convertedHTML = cleaned;
    setStatus('convertStatus', '변환 완료!', 'success');
    renderPreview(cleaned);
    document.getElementById('copyBtn').disabled = false;
    document.getElementById('tistoryGuide').classList.remove('hidden');
    document.getElementById('charCount').textContent = cleaned.length.toLocaleString() + '자';
  } catch (e) {
    setStatus('convertStatus', '오류: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ── 변환 시스템 프롬프트 생성 ── */
function buildConvertSystemPrompt({ useKatex, useImages, useMeta, useToc }) {
  const mathRule = useKatex
    ? `- Inline math $...$ → wrap with \\( ... \\). Block math $$...$$ → wrap with \\[ ... \\].
       Add at the very top of the output:
       <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css">
       <script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js"><\/script>
       <script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js"><\/script>
       <script>document.addEventListener("DOMContentLoaded",()=>renderMathInElement(document.body,{throwOnError:false}))<\/script>`
    : `- Convert math blocks to <pre class="math-block">...</pre>`;

  const imgRule = useImages
    ? `- Keep images as <img src="..." alt="..." style="max-width:100%;height:auto;display:block;margin:1rem auto;border-radius:6px">`
    : `- Remove all images`;

  const metaRule = useMeta
    ? `- Add a styled metadata block at the very top inside .paper-review:
       <div class="paper-meta">title, conference, year, tags from page properties</div>`
    : '';

  const tocRule = useToc
    ? `- Generate a <nav class="toc"> table of contents from all h2/h3 headings before the main content`
    : '';

  return `You are a Notion-to-Tistory HTML converter. Your job is to fetch a Notion page and return clean, styled HTML ready to paste into Tistory's HTML editor.

Conversion rules:
- Wrap everything in: <div class="paper-review"> ... </div>
- Add this <style> block at the very top (before KaTeX if applicable):
<style>
.paper-review{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.8;color:#1a1918;max-width:780px;margin:0 auto;font-size:15px}
.paper-review h1{font-size:24px;font-weight:700;margin:0 0 1.5rem;line-height:1.3}
.paper-review h2{font-size:18px;font-weight:700;border-left:4px solid #1a1918;padding-left:12px;margin:2rem 0 0.8rem}
.paper-review h3{font-size:16px;font-weight:600;color:#444;margin:1.5rem 0 0.5rem}
.paper-review h4{font-size:14px;font-weight:600;margin:1rem 0 0.4rem}
.paper-review p{margin:0 0 0.8rem}
.paper-review blockquote{border-left:4px solid #e0ddd8;padding:0.5rem 1rem;margin:1rem 0;color:#666;background:#f8f7f4;border-radius:0 6px 6px 0}
.paper-review hr{border:none;border-top:1px solid #e8e5e0;margin:2rem 0}
.paper-review details{margin:0.8rem 0;padding:0.7rem 1rem;border:1px solid #e8e5e0;border-radius:8px;background:#fafaf8}
.paper-review summary{cursor:pointer;font-weight:600;font-size:14px}
.paper-review .toc{background:#f8f7f4;padding:1rem 1.25rem;border-radius:8px;margin:0 0 2rem;font-size:14px}
.paper-review .toc h4{margin:0 0 0.5rem;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#999}
.paper-review .toc ul{padding-left:1.2rem;margin:0}
.paper-review .toc li{margin:3px 0}
.paper-review .paper-meta{background:#f8f7f4;border:1px solid #e8e5e0;border-radius:10px;padding:1rem 1.25rem;margin:0 0 2rem;display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13px}
.paper-review .paper-meta .meta-badge{display:inline-block;padding:3px 10px;border-radius:100px;background:#e8f0fb;color:#1a4d8f;font-weight:500}
.paper-review .math-block{background:#f8f7f4;padding:1rem;border-radius:6px;overflow-x:auto;font-size:14px}
</style>

${mathRule}
${imgRule}
${metaRule}
${tocRule}
- Convert Notion headings: # → h2, ## → h3, ### → h4
- Convert > quotes / callout blocks → <blockquote>
- Convert **bold** → <strong>, *italic* → <em>
- Convert --- → <hr>
- Convert toggle blocks → <details><summary>title</summary>content</details>
- Convert bullet/numbered lists → <ul>/<ol> with <li>
- Convert code blocks → <pre><code class="language-X">...</code></pre>
- Preserve paragraph spacing

Return ONLY the final HTML. No markdown fences. No explanation.`;
}

/* ── 미리보기 렌더 ── */
function renderPreview(html) {
  const rendered = document.getElementById('preview-rendered');
  rendered.innerHTML = html;

  // KaTeX 수식 렌더링
  if (window.renderMathInElement) {
    try {
      renderMathInElement(rendered, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
        ],
        throwOnError: false,
      });
    } catch (_) {}
  }

  document.getElementById('preview-html').textContent = html;
}

/* ── 탭 전환 ── */
function switchTab(tab) {
  document.getElementById('tab-rendered').className = 'tab' + (tab === 'rendered' ? ' active' : '');
  document.getElementById('tab-html').className = 'tab' + (tab === 'html' ? ' active' : '');
  document.getElementById('preview-rendered').classList.toggle('hidden', tab !== 'rendered');
  document.getElementById('preview-html').classList.toggle('hidden', tab !== 'html');
}

/* ── 클립보드 복사 ── */
async function copyToClipboard() {
  if (!convertedHTML) return;
  const btn = document.getElementById('copyBtn');
  try {
    await navigator.clipboard.writeText(convertedHTML);
  } catch (_) {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = convertedHTML;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg> 복사됨!`;
  setTimeout(() => {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> HTML 복사`;
  }, 2000);
}

/* ── 유틸 ── */
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position:'fixed', bottom:'24px', right:'24px', background:'#1a1918', color:'#fff',
    padding:'9px 16px', borderRadius:'8px', fontSize:'13px', zIndex:'9999',
    opacity:'0', transition:'opacity .2s',
  });
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; });
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 200);
  }, 2200);
}
