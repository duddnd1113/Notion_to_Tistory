# 노션 → 티스토리 변환기

노션에 작성한 논문 리뷰 페이지를 **클릭 한 번**으로 티스토리에 붙여넣을 수 있는 HTML로 변환해주는 웹 앱입니다.

LaTeX 수식, 이미지, 인용구, 토글 블록 등을 티스토리 에디터에서 깨지지 않도록 변환합니다.

---

## 주요 기능

- 노션 워크스페이스에서 논문 리뷰 페이지 검색
- LaTeX 수식 → KaTeX 렌더링 변환 (`$$...$$`, `$...$`)
- 이미지, 인용구, 토글, 구분선 등 서식 보존
- 논문 정보 헤더(학회, 연도, 태그) 선택적 추가
- 목차(TOC) 자동 생성 옵션
- 변환된 HTML 원클릭 복사

---

## 시작하기

### 1. 저장소 클론

```bash
git clone https://github.com/your-username/notion-to-tistory.git
cd notion-to-tistory
```

별도 설치가 필요 없습니다. `index.html`을 브라우저에서 바로 열거나, 간단한 로컬 서버를 띄워서 사용할 수 있습니다.

```bash
# Python이 있다면
python -m http.server 8080

# Node.js가 있다면
npx serve .
```

브라우저에서 `http://localhost:8080` 접속.

---

### 2. API 키 발급

앱을 사용하려면 두 가지 키가 필요합니다.

#### Anthropic API Key
1. [Anthropic Console](https://console.anthropic.com) 접속
2. API Keys → Create Key
3. `sk-ant-...` 형태의 키 복사

#### Notion Integration Token
1. [Notion My Integrations](https://www.notion.so/my-integrations) 접속
2. **New integration** 클릭
3. 이름 입력 후 생성 → `secret_...` 형태의 Internal Integration Token 복사
4. 노션에서 변환할 페이지(또는 상위 데이터베이스)에 들어가서 `...` 메뉴 → **Connections** → 방금 만든 integration 추가

---

### 3. 사용 방법

1. 앱에서 두 키를 입력하고 **저장**
2. 논문 제목 또는 키워드로 **검색**
3. 목록에서 원하는 페이지 **선택**
4. 변환 옵션 체크 후 **변환하기**
5. 미리보기 확인 후 **HTML 복사**
6. 티스토리 글쓰기 → 우측 상단 `</>` HTML 버튼 클릭 → **붙여넣기**

---

## 파일 구조

```
notion-to-tistory/
├── index.html   # 앱 구조 (HTML)
├── style.css    # 스타일
├── app.js       # 핵심 로직 (API 호출, 변환, 복사)
└── README.md
```

---

## 기술 스택

- Vanilla JS (프레임워크 없음, 빌드 불필요)
- [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) + [MCP Client](https://docs.anthropic.com/en/docs/build-with-claude/mcp)
- [Notion MCP Server](https://mcp.notion.com/mcp) — 노션 페이지 읽기
- [KaTeX](https://katex.org) — 수식 렌더링

---

## 주의사항

- API 키는 브라우저 `localStorage`에만 저장되며 외부 서버로 전송되지 않습니다.
- Anthropic API 사용량에 따라 요금이 발생할 수 있습니다 (페이지당 약 $0.01~0.03 수준).
- 노션 이미지 URL은 S3 임시 URL이므로 **티스토리에 올린 뒤 이미지가 만료되기 전에 직접 업로드**하는 것을 권장합니다.

---

## 라이선스

MIT
