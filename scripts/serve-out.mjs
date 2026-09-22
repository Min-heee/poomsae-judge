/**
 * 내보낸 out/ 을 그대로 열어 보는 정적 서버.
 *
 * 저장소 루트에서:  npm run preview
 *
 * 의존성이 없다. 예전에는 `npx --yes serve@14 out` 이었는데, 그 한 줄은
 * (1) 최초 실행에 네트워크가 필요하고 — README 가 "로컬에서 열어 보기"라고만
 * 적어 두어 오프라인에서도 되는 것처럼 읽혔다 —, (2) `serve@14` 의 마이너
 * 버전이 떠 있어 결정성 원칙과도 어긋났다. node 표준 모듈만 쓰면 둘 다 사라진다.
 *
 * `trailingSlash: true` 로 내보내므로 /judge/ → out/judge/index.html 이다.
 * 이 서버도 같은 규칙으로 찾는다 — 배포된 Pages 와 다르게 동작하면 미리 보는
 * 의미가 없다.
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(process.argv[2] ?? "out");
const PORT = Number(process.env.PORT ?? 3100);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

/** ROOT 밖으로 나가는 경로를 막는다. */
function safeJoin(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const full = join(ROOT, rel);
  return full.startsWith(ROOT) ? full : null;
}

async function resolveFile(urlPath) {
  const base = safeJoin(urlPath);
  if (base === null) return null;

  const candidates = base.endsWith("/")
    ? [join(base, "index.html")]
    : [base, join(base, "index.html"), `${base}.html`];

  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      /* 다음 후보 */
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const file = await resolveFile(req.url ?? "/");
  if (file === null) {
    const notFound = await resolveFile("/404.html");
    if (notFound !== null) {
      res.writeHead(404, { "content-type": MIME[".html"] });
      createReadStream(notFound).pipe(res);
      return;
    }
    res.writeHead(404, { "content-type": MIME[".txt"] });
    res.end(`찾을 수 없습니다: ${req.url}\n`);
    return;
  }

  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-cache",
  });
  createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`${ROOT} → http://localhost:${PORT}`);
});
