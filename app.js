/* ============================================================
   노션 → 티스토리 변환기  |  app.js
   ============================================================ */

let convertedHTML = '';
let selectedPageId = null;

/* ── 초기화 ── */
window.addEventListener('DOMContentLoaded', () => {
  const nt = localStorage.getItem('notionToken');
  if (nt) document.getElementById('notionToken').value = nt;

  const cn = localStorage.getItem('cloudName');
  const ck = localStorage.getItem('cloudApiKey');
  const cs = localStorage.getItem('cloudApiSecret');
  if (cn) document.getElementById('cloudName').value = cn;
  if (ck) document.getElementById('cloudApiKey').value = ck;
  if (cs) document.getElementById('cloudApiSecret').value = cs;
});

/* ── 토큰 저장 ── */
function saveKeys() {
  const nt = document.getElementById('notionToken').value.trim();
  if (!nt) { alert('Notion 토큰을 입력해주세요.'); return; }
  localStorage.setItem('notionToken', nt);
  showToast('토큰이 저장되었습니다 ✓');
}

function saveCloudinary() {
  const cn = document.getElementById('cloudName').value.trim();
  const ck = document.getElementById('cloudApiKey').value.trim();
  const cs = document.getElementById('cloudApiSecret').value.trim();
  localStorage.setItem('cloudName', cn);
  localStorage.setItem('cloudApiKey', ck);
  localStorage.setItem('cloudApiSecret', cs);
  showToast('Cloudinary 정보가 저장되었습니다 ✓');
}

function toggleVis(id) {
  const el = document.getElementById(id);
  el.type = el.type === 'password' ? 'text' : 'password';
}

function setStatus(id, msg, type = '') {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = 'status' + (type ? ' ' + type : '');
  el.classList.remove('hidden');
}

function notionToken() {
  return localStorage.getItem('notionToken');
}

/* ── URL → 페이지 ID 파싱 ── */
function parseNotionPageId(url) {
  if (!url) return null;
  url = url.trim();

  // notion.so/pagename-{32자 hex} 형식
  const m1 = url.match(/([a-f0-9]{32})(?:[?#]|$)/i);
  if (m1) return formatUuid(m1[1]);

  // notion.so/{workspace}/{uuid} 형식
  const m2 = url.match(/notion\.so\/(?:[^/]+\/)?([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  if (m2) return m2[1];

  return null;
}

function formatUuid(hex) {
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

/* ── URL 입력 시 실시간 검증 ── */
function onUrlInput(value) {
  const id = parseNotionPageId(value);
  if (!value.trim()) {
    document.getElementById('urlStatus').classList.add('hidden');
    selectedPageId = null;
    document.getElementById('convertBtn').disabled = true;
    return;
  }
  if (id) {
    selectedPageId = id;
    setStatus('urlStatus', `✓ 페이지 ID: ${id}`, 'success');
    document.getElementById('convertBtn').disabled = false;
  } else {
    selectedPageId = null;
    setStatus('urlStatus', 'Notion 페이지 URL을 확인해주세요.', 'error');
    document.getElementById('convertBtn').disabled = true;
  }
}

/* ── 변환 ── */
async function convertPage() {
  if (!selectedPageId) return;

  const token = notionToken();
  if (!token) {
    setStatus('convertStatus', 'Notion 토큰을 먼저 저장해주세요.', 'error');
    return;
  }

  const btn = document.getElementById('convertBtn');
  btn.disabled = true;
  setStatus('convertStatus', '페이지를 불러오는 중...', 'loading');

  try {
    const cloudName   = localStorage.getItem('cloudName') || '';
    const cloudApiKey = localStorage.getItem('cloudApiKey') || '';
    const cloudApiSecret = localStorage.getItem('cloudApiSecret') || '';
    const cloudinary = (cloudName && cloudApiKey && cloudApiSecret)
      ? { cloudName, apiKey: cloudApiKey, apiSecret: cloudApiSecret }
      : null;

    if (cloudinary) setStatus('convertStatus', '페이지를 불러오는 중... (이미지 업로드 포함)', 'loading');

    const res = await fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-notion-token': token },
      body: JSON.stringify({
        pageId: selectedPageId,
        options: {
          katex:  document.getElementById('optKatex').checked,
          images: document.getElementById('optImages').checked,
          meta:   document.getElementById('optMeta').checked,
          toc:    document.getElementById('optToc').checked,
        },
        cloudinary,
      }),
    });

    if (!res.ok) throw new Error((await res.json()).error || `서버 오류 (${res.status})`);
    const data = await res.json();
    const html = data.html || '';

    if (!html || html.length < 50) {
      setStatus('convertStatus', '변환 결과가 비어있어요. 페이지 내용을 확인해주세요.', 'error');
      btn.disabled = false;
      return;
    }

    convertedHTML = html;
    setStatus('convertStatus', '변환 완료!', 'success');
    renderPreview(html);
    document.getElementById('copyBtn').disabled = false;
    document.getElementById('tistoryGuide').classList.remove('hidden');
    document.getElementById('charCount').textContent = html.length.toLocaleString() + '자';
  } catch (e) {
    setStatus('convertStatus', '오류: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ── 미리보기 ── */
function renderPreview(html) {
  const rendered = document.getElementById('preview-rendered');
  rendered.innerHTML = html;

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

function switchTab(tab) {
  document.getElementById('tab-rendered').className = 'tab' + (tab === 'rendered' ? ' active' : '');
  document.getElementById('tab-html').className    = 'tab' + (tab === 'html'     ? ' active' : '');
  document.getElementById('preview-rendered').classList.toggle('hidden', tab !== 'rendered');
  document.getElementById('preview-html').classList.toggle('hidden',     tab !== 'html');
}

async function copyToClipboard() {
  if (!convertedHTML) return;
  const btn = document.getElementById('copyBtn');
  try {
    await navigator.clipboard.writeText(convertedHTML);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = convertedHTML;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> 복사됨!`;
  setTimeout(() => {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> HTML 복사`;
  }, 2000);
}

function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position:'fixed', bottom:'24px', right:'24px', background:'#003876', color:'#fff',
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
