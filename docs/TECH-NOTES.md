# 기술 실사 노트

작성 2026-09-22 · 검증 환경 macOS(darwin 25.5.0, arm64), node v23.11.0, npm 10.9.2

이 문서의 버전과 URL은 전부 **오늘 npm registry와 실제 HTTP 요청으로 확인한 값**입니다. 추정치는 "미검증"이라고 표시했습니다. 아래 검증은 임시 폴더에서 수행했고 끝난 뒤 지웠습니다. 저장소에는 아무 코드도 설치하지 않았습니다.

---

## 0. 먼저 볼 것 — PRD와 충돌하는 항목 2개

### (가) F9(LLM 서버 라우트)와 F8(정적 배포)은 동시에 성립하지 않는다

PRD F9는 "서버 라우트 + 환경변수로만 호출"이라고 적었고, F8은 "정적 배포(GitHub Pages)"입니다. `output: 'export'`에서 Route Handler는 **GET + `export const dynamic = 'force-static'`만** 지원하고, Request를 읽는 핸들러는 지원하지 않습니다. POST로 판정 결과를 받아 문장을 만드는 라우트는 빌드 자체가 실패합니다. 공식 문서의 "Unsupported Features" 목록에 `Route Handlers that rely on Request`가 명시돼 있습니다.

즉 **정적 배포를 유지하는 한 런타임 LLM 호출은 불가능**합니다. 선택지는 9절에 정리했고, 권장안은 **빌드타임 생성 + 규칙 기반 폴백**입니다(키가 런타임에 아예 존재하지 않으므로 원칙 4가 자동으로 지켜집니다).

### (나) "샘플 3종 녹화"보다 합성 생성이 낫다

PRD 8절 남은 일에 "샘플 3종 녹화"가 있습니다. 녹화·추출 방식은 (1) 결정성이 추론 백엔드에 묶이고, (2) 실패 케이스를 의도적으로 만들 수 없고, (3) 영상 출처의 라이선스 문제가 붙습니다. **합성 생성**이면 생성 스크립트가 저장소에 남아 "이 샘플이 어떻게 만들어졌는지"까지 심사 대상이 됩니다. 설계는 8절에 있습니다.

---

## 1. 확정 버전 표

| 패키지 | 확정 버전 | 최신 | 비고 |
|---|---|---|---|
| `next` | **15.5.25** | 16.3.5 | 15 계열 최신. 정적 내보내기 빌드 실측 통과 |
| `react` / `react-dom` | **19.1.0** | 19.3.0 | `create-next-app@15.5.25`가 고정하는 값 |
| `typescript` | **^5** → 5.9.3 | 7.0.2 | TS 7은 네이티브 포팅판. `^5` 유지 |
| `@mediapipe/tasks-vision` | **1.0.1** | 1.0.1 | Apache-2.0. 2026-07-28 1.0.0 승격 |
| `three` | **0.186.0** | 0.186.0 | MIT |
| `@types/three` | **0.186.0** | 0.186.0 | **필수**(three는 타입 미동봉, 아래 참조) |
| `vitest` | **3.2.7** | 5.0.1 | 4·5는 이 맥의 npm에서 설치 불가(5절) |
| `@react-three/fiber` | **쓰지 않음** | 9.7.0 | 이유는 6절 |

`@types/node`, `@types/react`, `@types/react-dom`는 create-next-app 기본값 그대로.

### Next 15 대 16

둘 다 정적 내보내기 실측 통과했습니다. 15.5.25(2026-08-31 배포)는 여전히 유지보수 중이고, `create-next-app@latest`는 오늘 16.3.5 + react 19.2.8을 줍니다. PRD·과제가 15로 못 박았으므로 **15.5.25로 진행**하되, 16으로 바꿔도 `next.config.ts` 한 줄도 달라지지 않습니다(둘 다 검증함). 다만 16은 내보내기 산출물 배치가 다릅니다 — 7절 트레일링 슬래시 항목을 반드시 보세요.

---

## 2. 실제로 돌려 본 것 (증거)

임시 폴더에서 수행하고 삭제했습니다.

| 시험 | 결과 |
|---|---|
| `npx create-next-app@latest` (node 23.11.0) | **성공**, 347패키지 17초. next 16.3.5 / react 19.2.8 / typescript 5.9.3 |
| `npx create-next-app@15.5.25` | **성공**. next 15.5.25 / react 19.1.0. `build` 스크립트에 `--turbopack` 기본 포함 |
| next 15 + `output:'export'` + three + mediapipe 빌드 | **성공**. `/judge` 40.6 kB, First Load 154 kB, `out/judge/index.html` 생성 |
| 클라이언트 컴포넌트에서 **top-level** `import {...} from '@mediapipe/tasks-vision'` | **프리렌더 깨지지 않음**. 라우트 46.3 kB(+5.7 kB) |
| next 16 + `basePath=$PAGES_BASE_PATH` 빌드 | **성공**. HTML에 `/poomsae-judge/_next/...`로 치환 확인 |
| 브라우저에서 CDN WASM + lite 모델 실제 초기화 | **성공** (아래) |
| `npx vitest run` (설정 파일 0개, jsdom 없음) | **성공**. 순수 함수 테스트 2개 통과, 363ms |
| `npm i -D vitest@5.0.1` / `@4.1.11` | **실패**(재현 100%) — 5절 |

브라우저 실측 로그(실제 출력):

```
module loaded, exports incl: FilesetResolver,PoseLandmarker,DrawingUtils
simd supported: true
wasm fileset ok (157ms)
PoseLandmarker created (1089ms total)     ← 5.5MB 모델 다운로드 포함, 콜드
POSE_CONNECTIONS count: 35
detectForVideo ok. poses=0 worldPoses=0   ← 빈 이미지 → 0개 (깨끗한 미검출 경로)
result keys: landmarks,worldLandmarks,segmentationMasks
```

---

## 3. MediaPipe PoseLandmarker

### 3.1 초기화 (검증된 형태)

```ts
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

const MP_VERSION = '1.0.1'; // package.json과 반드시 동일하게 유지

const vision = await FilesetResolver.forVisionTasks(
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`,
);

const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath:
      'https://storage.googleapis.com/mediapipe-models/pose_landmarker/' +
      'pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    delegate: 'GPU',          // 실패 시 'CPU'로 재시도하는 경로를 둘 것
  },
  runningMode: 'VIDEO',
  numPoses: 1,
});
```

`runningMode`는 `'IMAGE' | 'VIDEO'`이고 `setOptions({ runningMode })`로 나중에 바꿀 수 있지만, **모드를 바꾸면 그래프가 재생성**되므로 처음부터 `'VIDEO'`로 만드는 편이 낫습니다.

### 3.2 프레임 루프 — 타임스탬프가 핵심

```ts
let lastVideoTime = -1;
function loop() {
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const res = poseLandmarker.detectForVideo(video, performance.now());
    handle(res);
  }
  requestAnimationFrame(loop);
}
```

`detectForVideo(videoFrame, timestamp)`는 **동기 반환**입니다(콜백 오버로드도 있음). `timestamp`는 ms이고 **단조 증가해야** 합니다. 같은 값이나 감소하는 값을 주면 내부에서 예외가 납니다 — `video.currentTime`을 ms로 바꿔 쓰면 일시정지·되감기 때 터집니다. `performance.now()`를 쓰고, 같은 프레임 중복 추론은 위처럼 `currentTime` 비교로 거르세요.

### 3.3 반환 타입 (동봉 `vision.d.ts`에서 그대로 발췌)

```ts
export declare interface NormalizedLandmark {
  x: number; y: number; z: number;
  visibility: number;      // ← optional 아님. 항상 존재
}
export declare interface Landmark {      // worldLandmarks 원소
  x: number; y: number; z: number;
  visibility: number;
}
export declare class PoseLandmarkerResult {
  readonly landmarks: NormalizedLandmark[][];       // 포즈별 33개
  readonly worldLandmarks: Landmark[][];            // 포즈별 33개, 미터
  readonly segmentationMasks?: MPMask[];
}
```

**문서와 타입이 다릅니다.** 웹 문서 산문에는 `presence` 필드가 있다고 적혀 있지만 **TS 타입에는 `presence`가 없습니다**. H1(신뢰도) 조건은 `visibility`만으로 설계하세요.

`numPoses: 1`이어도 `landmarks`는 2중 배열입니다. 미검출이면 `landmarks.length === 0`이므로 `landmarks[0]`은 `undefined`입니다 — H2(무효 프레임) 판정의 1차 신호로 쓰기 좋습니다.

### 3.4 좌표계 — 규칙 설계에 직결되는 함정

**`landmarks`(정규화)의 x는 이미지 *너비*로, y는 *높이*로 나눈 값입니다.** 영상이 정사각형이 아니면 x와 y의 스케일이 다르므로, **raw x,y로 계산한 각도는 실제 각도가 아닙니다.** 16:9 영상에서 진짜 90°가 약 60°로 나옵니다. PRD 5절 규칙(A2 무릎 내각, A4 상체 수직각, B4 펴짐)이 전부 각도이므로 이건 치명적입니다.

둘 중 하나를 고르고 문서에 못 박으세요.

1. **`worldLandmarks`(미터)로 각도를 계산** — 종횡비 문제가 없고 단위가 미터라 A1·B3의 비율 정규화 `S`도 자연스럽습니다. 권장.
2. `landmarks`를 쓰되 **x에 종횡비를 곱해** 보정: `x' = x * (videoWidth / videoHeight)`.

`landmarks`는 2D 오버레이 그리기에만 쓰는 것이 안전합니다.

`worldLandmarks`는 **엉덩이 중점이 원점, 단위 미터**입니다. 축 방향(특히 y가 위인지 아래인지, z 부호)은 빈 이미지로는 확인하지 못했습니다 — **미검증**. 첫 실제 포즈가 들어오는 순간 `landmarks[0][0]`(코)과 `[27]`(왼발목)의 y 부호를 찍어 보고 three.js 쪽 y 반전 여부를 정하세요. 이미지 좌표계 관례상 y가 아래로 증가할 가능성이 높습니다.

### 3.5 모델을 커밋할 것인가 — **커밋하지 않는다**

| | 크기 | CORS |
|---|---|---|
| `pose_landmarker_lite.task` | 5,777,746 B (5.5 MB) | `access-control-allow-origin: *` |
| `pose_landmarker_full.task` | 9,398,198 B (9.0 MB) | 동일 |
| `pose_landmarker_heavy.task` | 30,664,242 B (29 MB) | 동일 |
| WASM `vision_wasm_internal.wasm` | 11,756,954 B | jsdelivr, `*`, `immutable` |

세 URL 전부 HTTP 200 실측. GitHub Pages 오리진(`https://min-heee.github.io`)을 `Origin` 헤더로 넣어 요청했고 **둘 다 `access-control-allow-origin: *`** 를 반환했습니다. 즉 Pages에서 바로 받아 쓸 수 있습니다.

커밋하지 않는 이유:

- **라이선스.** 패키지 `@mediapipe/tasks-vision`는 Apache-2.0이고 mediapipe 저장소도 Apache-2.0이지만, **모델 가중치 아티팩트 자체의 라이선스를 Google이 명시적으로 고지한 문서는 찾지 못했습니다.** 이 점을 지적한 공개 이슈(google-ai-edge/mediapipe #6355 "Artifact-specific license and provenance")가 열려 있습니다. 재배포하지 않고 공식 URL에서 받으면 이 불확실성을 통째로 피합니다.
- **용량.** 모델 5.5MB + WASM(simd/nosimd) 약 23MB를 넣으면 저장소가 30MB에 육박합니다. 심사용 저장소로는 과합니다.
- **필요 없음.** 샘플 모드는 추론을 하지 않으므로 **모델도 WASM도 받지 않습니다.** 웹캠을 켠 사람만 받습니다.

따라서 **MediaPipe 전체를 동적 import**로 미루는 것을 권합니다. top-level import도 빌드는 깨지지 않지만(2절 실측), 샘플 모드만 보는 심사위원에게 5.7 kB 번들과 초기화 코드를 보낼 이유가 없습니다.

```ts
async function loadPose() {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  // ...
}
```

`@latest`를 URL에 쓰지 마세요. 결정성 원칙에 정면으로 어긋나고, 어느 날 조용히 깨집니다. `MP_VERSION` 상수 한 곳에서 관리하고 `package.json`과 일치시키세요.

### 3.6 스켈레톤 토폴로지 (브라우저에서 추출한 실제 값)

`PoseLandmarker.POSE_CONNECTIONS`는 **35개**, 원소는 `{ start, end }`입니다. 실측 전체 목록:

```ts
// PoseLandmarker.POSE_CONNECTIONS 를 [start, end] 로 편 것 (35개)
export const POSE_EDGES: [number, number][] = [
  [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],
  [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],
  [12,14],[14,16],[16,18],[16,20],[16,22],[18,20],
  [11,23],[12,24],[23,24],
  [23,25],[24,26],[25,27],[26,28],
  [27,29],[28,30],[29,31],[30,32],[27,31],[28,32],
];
```

랜드마크 인덱스 33개: 0 코 / 1–3 왼눈(안·중·밖) / 4–6 오른눈 / 7 왼귀 / 8 오른귀 / 9–10 입(좌·우) / 11–12 어깨 / 13–14 팔꿈치 / 15–16 손목 / 17–18 새끼 / 19–20 검지 / 21–22 엄지 / 23–24 엉덩이 / 25–26 무릎 / 27–28 발목 / 29–30 뒤꿈치 / 31–32 발끝. **홀수=왼쪽, 짝수=오른쪽**(0 제외).

`DrawingUtils`도 export되지만 2D 캔버스용입니다. three.js로 그린다면 필요 없습니다.

---

## 4. Next.js 정적 내보내기 + GitHub Pages

### 4.1 설정 — 공식 템플릿 방식을 그대로

`nextjs/deploy-github-pages` 템플릿의 실제 `next.config.ts`는 이렇습니다(raw 파일 확인):

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  basePath: process.env.PAGES_BASE_PATH,
};

export default nextConfig;
```

`basePath`를 하드코딩하지 않고 **환경변수**로 받는 것이 핵심입니다. 로컬 `next dev`에서는 `undefined`라 `/`로 뜨고, CI에서만 `/poomsae-judge`가 들어갑니다. `assetPrefix`는 **따로 설정할 필요가 없습니다** — `basePath`가 `_next` 자산 경로까지 처리합니다(실측: HTML에 `/poomsae-judge/_next/static/...`로 치환됨).

여기에 두 줄을 더하길 권합니다.

```ts
  trailingSlash: true,                 // 7절 참조
  images: { unoptimized: true },       // next/image를 쓸 경우에만
```

### 4.2 워크플로 (템플릿 실제 내용, 요지)

`actions/configure-pages@v5`가 `outputs.base_path`를 주고 그것을 빌드 env로 넘깁니다.

```yaml
      - name: Setup Pages
        id: setup_pages
        uses: actions/configure-pages@v5

      - name: Build with Next.js
        run: npm run build
        env:
          PAGES_BASE_PATH: ${{ steps.setup_pages.outputs.base_path }}

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: ./out
```

permissions는 `contents: read`, `pages: write`, `id-token: write`. deploy 잡은 `actions/deploy-pages@v4`. 템플릿은 pnpm + node 22를 쓰지만 npm으로 바꿔도 무방합니다.

**`.nojekyll`은 필요 없습니다** — artifact 방식(`upload-pages-artifact` + `deploy-pages`)은 Jekyll을 돌리지 않으므로 `_next` 디렉터리가 잘리지 않습니다. 단, 옛날 방식으로 `gh-pages` 브랜치에 직접 푸시한다면 `.nojekyll`이 **반드시** 필요합니다(`_`로 시작하는 디렉터리가 삭제됨).

### 4.3 `output: 'export'`에서 못 쓰는 것 (공식 목록)

Dynamic Routes(`generateStaticParams` 없이 / `dynamicParams: true`), **Request에 의존하는 Route Handler**, `cookies`, Rewrites, Redirects, Headers, Proxy, ISR, 기본 loader의 Image Optimization, Draft Mode, **Server Actions**, Intercepting Routes.

쓸 수 있는 것: Server Components(빌드타임 실행), Client Components, **GET + `force-static` Route Handler**(정적 JSON 파일로 구워짐).

이 프로젝트에 실질적으로 걸리는 건 **Server Actions와 동적 Route Handler뿐**이고, 둘 다 9절의 LLM 항목에만 관계됩니다. 판정 코어·샘플 재생·three.js는 전부 클라이언트라 아무 제약이 없습니다.

### 4.4 브라우저 API

`'use client'` 컴포넌트도 **빌드 시 HTML로 프리렌더**됩니다. `window`·`navigator.mediaDevices`·`localStorage`는 모듈 최상단이나 렌더 본문에서 만지면 빌드가 깨집니다. `useEffect` 안에서만 접근하세요. 웹캠 코드 전체가 여기 해당합니다.

---

## 5. vitest — 이 맥에서 걸리는 것

### 5.1 순수 함수만 테스트하므로 jsdom 불필요

기본 `environment`가 `'node'`입니다. 판정 코어가 순수 함수라면 **jsdom·happy-dom 둘 다 설치할 필요가 없습니다.** vitest가 TS를 esbuild로 직접 처리하므로 별도 TS 설정도 필요 없습니다. 실측: 설정 파일 0개 상태에서 `npx vitest run`이 `lib/score.test.ts`를 찾아 통과시켰습니다(363ms).

그래도 최소 설정은 두는 편이 낫습니다 — `.next`를 긁지 않게 하려고:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'out'],
  },
});
```

```json
"scripts": { "test": "vitest run", "test:watch": "vitest" }
```

### 5.2 **vitest 4·5는 이 맥에서 설치가 안 된다**

```
$ npm i -D vitest@5.0.1
npm error Cannot read properties of null (reading 'edgesOut')
```

재현 100%. `vitest@4.1.11`도 동일. **`vitest@3.2.7`은 정상 설치**됩니다. npm 10.9.2(node 23.11.0 동봉)의 arborist 버그이고 vitest 4·5의 optional peer 그래프(`@vitest/browser-*`, `vite ^6||^7||^8` 등)에서 터집니다.

확인한 우회로:

| 방법 | 결과 |
|---|---|
| `vitest@3.2.7` | **성공** |
| `npm i -D vitest@5.0.1 --legacy-peer-deps` | 성공 |
| `npx npm@11 i -D vitest@5.0.1` | 성공 (5.0.1 설치 확인) |
| `vitest@5.0.1 vite@8.3.0` 동시 설치 | 실패 |

**권장: `vitest@3.2.7` 고정.** 이유는 심사위원 환경입니다. node 22 LTS에는 npm 10.9.x가 동봉되므로, 저장소를 clone한 심사위원이 `npm install`에서 그대로 실패할 수 있습니다. 첫인상이 "설치가 안 되는 저장소"가 되는 위험을 감수할 가치가 없습니다. 순수 함수 테스트에 vitest 3과 5의 기능 차이는 없습니다. `.npmrc`에 `legacy-peer-deps=true`를 박는 방식은 원인을 숨기므로 쓰지 마세요.

`package.json`에 `"engines": { "node": ">=20.9.0" }`를 적어 두면 친절합니다.

---

## 6. three.js 스켈레톤 — `@react-three/fiber`를 쓰지 않는 이유

### 6.1 R3F의 React 버전 절벽

`@react-three/fiber@9.7.0`의 peer는 **`react: ">=19 <19.3"`** 입니다(9.5.0부터 상한이 생겼습니다 — 9.4.x까지는 `^19.0.0`이었음). 그런데 **react 최신은 19.3.0**입니다. 즉 누군가 `npm i react@latest`를 하거나 새 scaffold가 19.3을 집는 순간 `ERESOLVE`로 설치가 깨집니다. 지금 15.5.25 scaffold가 주는 19.1.0에서는 우연히 맞지만(dry-run 확인), 이건 시한폭탄입니다.

### 6.2 그리고 R3F가 필요 없다

그릴 것은 구 33개와 선분 35개뿐이고, **프레임을 우리가 직접 제어해야** 합니다(타임라인 스크럽 = 특정 프레임으로 점프, PRD F4). 명령형 three.js가 오히려 짧고 결정적입니다. 의존성도 2개(three, @types/three) 줄어듭니다.

### 6.3 최소 구현

관절은 `InstancedMesh` 1개(구 33개), 뼈대는 `LineSegments` 1개(정점 70개)면 끝입니다. 드로우콜 2회.

```ts
import * as THREE from 'three';
import { POSE_EDGES } from './pose-topology';

const N = 33;

// 관절
const joints = new THREE.InstancedMesh(
  new THREE.SphereGeometry(0.018, 12, 12),
  new THREE.MeshStandardMaterial({ color: 0x3b82f6 }),
  N,
);
joints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

// 뼈대: edge 하나당 정점 2개
const lineGeom = new THREE.BufferGeometry();
const linePos = new Float32Array(POSE_EDGES.length * 2 * 3);
lineGeom.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
const bones = new THREE.LineSegments(
  lineGeom,
  new THREE.LineBasicMaterial({ color: 0x94a3b8 }),
);

const m = new THREE.Matrix4();

export function updateSkeleton(lm: { x: number; y: number; z: number }[]) {
  for (let i = 0; i < N; i++) {
    const p = lm[i];
    m.makeTranslation(p.x, -p.y, -p.z);   // y·z 부호는 3.4절대로 실측 후 확정
    joints.setMatrixAt(i, m);
  }
  joints.instanceMatrix.needsUpdate = true;

  for (let e = 0; e < POSE_EDGES.length; e++) {
    const [a, b] = POSE_EDGES[e];
    const o = e * 6;
    linePos[o]     =  lm[a].x; linePos[o + 1] = -lm[a].y; linePos[o + 2] = -lm[a].z;
    linePos[o + 3] =  lm[b].x; linePos[o + 4] = -lm[b].y; linePos[o + 5] = -lm[b].z;
  }
  lineGeom.attributes.position.needsUpdate = true;
  lineGeom.computeBoundingSphere();       // 빼먹으면 카메라 밖이라 판단해 사라짐
}
```

빠뜨리기 쉬운 것:
- `instanceMatrix.needsUpdate = true` / `attributes.position.needsUpdate = true` — 없으면 첫 프레임에서 굳습니다.
- `computeBoundingSphere()` — 없으면 프러스텀 컬링이 스켈레톤을 통째로 지웁니다.
- `MeshStandardMaterial`을 쓰면 조명이 필요합니다. 조명 세팅이 귀찮으면 `MeshNormalMaterial`이나 `MeshBasicMaterial`로 시작하세요.
- three r152+부터 `renderer.outputColorSpace`가 기본 `SRGBColorSpace`입니다. 예전 예제 코드의 `outputEncoding`은 **제거됐습니다**.
- 언마운트 시 `geometry.dispose()` / `material.dispose()` / `renderer.dispose()`. React StrictMode의 이중 마운트에서 컨텍스트가 샙니다.
- `three`는 **타입을 동봉하지 않습니다**(`package.json`에 `types` 필드 없음, exports에도 없음). `@types/three`가 없으면 `next build`의 타입체크가 `Could not find a declaration file for module 'three'`로 **실패**합니다. 실측으로 이 실패를 재현했습니다.

---

## 7. 함정 목록

정적 배포·빌드

1. **`trailingSlash`**. 기본값(false)이면 `out/judge.html`이 나오고, `true`면 `out/judge/index.html`이 나옵니다(둘 다 실측). GitHub Pages는 `/judge` → `judge.html`은 처리하지만 `/judge/`는 404입니다. **`trailingSlash: true` 권장** — 두 경로 모두 살아납니다.
2. **`basePath`를 하드코딩하지 말 것.** 로컬 dev가 `/poomsae-judge`로 열려 자산이 전부 깨집니다. `process.env.PAGES_BASE_PATH`로.
3. **`basePath`는 `fetch` 경로에 자동 적용되지 않습니다.** `public/samples/*.json`을 `fetch('/samples/a.json')`로 부르면 Pages에서 404입니다. `` `${basePath}/samples/a.json` `` 형태로 직접 붙이거나, 샘플 JSON을 **import**해서 번들에 넣으세요(수백 KB면 import가 더 안전하고 결정적입니다).
4. `next build`는 기본으로 타입체크를 돌립니다. `@types/three` 누락이 여기서 터집니다.
5. next 15.5 scaffold의 build 스크립트에 `--turbopack`이 들어 있습니다. 정적 내보내기와 함께 정상 동작함을 확인했습니다.

MediaPipe

6. **`presence` 필드는 타입에 없습니다.** `visibility`만 쓰세요.
7. **`detectForVideo`의 timestamp는 단조 증가해야 합니다.** 일시정지·되감기에서 `currentTime` 기반 타임스탬프는 역행합니다.
8. **정규화 좌표의 x·y는 스케일이 다릅니다.** 각도 계산에 raw로 쓰면 틀립니다(3.4절). 이게 이 프로젝트에서 제일 조용하고 제일 치명적인 버그입니다.
9. CDN URL에 `@latest` 금지. 버전 상수 1개로 고정.
10. `delegate: 'GPU'`가 일부 환경(구형 GPU, 헤드리스, 일부 리눅스 브라우저)에서 실패합니다. CPU 폴백 경로를 두세요.
11. 미검출 프레임에서 `landmarks[0]`은 `undefined`입니다. 인덱싱 전에 길이 확인.
12. 콜드 초기화가 약 1.1초(모델 5.5MB 포함)입니다. 로딩 상태 UI가 필요합니다.

npm·환경

13. **`vitest@4`·`@5`는 npm 10.9.2에서 설치 불가**(5절).
14. node 23.11.0은 홀수 비 LTS 라인이라 `EBADENGINE` 경고가 납니다(`eslint-visitor-keys`가 `^20.19 || ^22.13 || >=24` 요구). 경고일 뿐 설치·빌드는 통과합니다. CI는 node 22로 고정하세요.
15. `typescript`를 `^5`로 두세요. `latest`는 7.0.2(네이티브 포팅판)이고 next의 타입 플러그인·eslint-config-next 호환이 미검증입니다.

---

## 8. 샘플 랜드마크 시퀀스 — 합성 생성 권장안

### 8.1 왜 합성인가

공개 영상 추출은 (1) 라이선스가 실제로 재배포·파생을 허용하는지 확인이 어렵고, (2) 추출 결과가 추론 백엔드·버전에 묶여 **결정성 원칙 2와 충돌**하며, (3) **실패 케이스를 만들 수 없습니다.** PRD F5는 "일부러 손상시킨 샘플이 보류로 떨어질 것"을 완료 기준으로 삼는데, 이건 합성이 아니면 만들기 어렵습니다.

합성은 반대로 **생성 스크립트 자체가 심사 대상**이 됩니다. "이 JSON이 어디서 왔는가"에 `scripts/generate-samples.ts`로 답할 수 있습니다. 시드 고정 PRNG를 쓰면 누구든 같은 파일을 다시 만들 수 있습니다.

정직하게 적을 것: 합성 데이터는 **규칙의 정확성을 증명하지 않습니다.** 규칙이 의도대로 동작하는지(회귀)만 증명합니다. README와 PRD 8절 리스크에 이 한 줄이 반드시 들어가야 합니다.

### 8.2 생성 구조

**세계 좌표(미터, 엉덩이 중점 원점)로 만들고, 필요하면 이미지 좌표로 투영**합니다. `worldLandmarks`와 같은 의미를 갖게 되어 3.4절 문제가 애초에 생기지 않습니다.

1. **골격 정의.** 신장 `H`(예: 1.70m)에 인체계측 비율을 곱해 분절 길이를 고정합니다. 대략 넓적다리 0.245H, 정강이 0.246H, 발길이 0.152H, 위팔 0.186H, 아래팔 0.146H, 어깨너비 0.259H, 골반너비 0.191H. 전부 상수 파일 하나에.
2. **관절각 벡터 θ(t).** 자유도는 필요한 것만 — 좌우 고관절 굴곡·외전, 좌우 무릎 굴곡, 골반 회전·기울기, 몸통 전후굴, 좌우 어깨·팔꿈치. 20개 남짓이면 충분합니다.
3. **키프레임 + 보간.** 동작 국면마다 θ를 찍고 사이를 부드럽게 잇습니다. **선형 보간은 로봇처럼 보입니다** — smoothstep이나 Catmull-Rom을 쓰고, 국면마다 다른 이징을 주세요.
4. **순운동학으로 관절 위치 계산** → 골반에서 시작해 체인을 따라 내려가며 33개 좌표를 채웁니다.
5. **파생 랜드마크.** 얼굴 0–10은 머리 위치·방향에서 고정 오프셋으로, 손 17–22는 손목 + 아래팔 방향에서, 발 29–32는 발목 + 발 방향에서 만듭니다. 규칙이 쓰지 않는 점들이라 대충이어도 되지만 스켈레톤이 사람처럼 보이려면 있어야 합니다.
6. **30fps로 샘플링**, 프레임마다 `{ t, landmarks[33] }` 기록. `visibility`는 기본 0.95 같은 상수.
7. **결정적 잡음.** `mulberry32(seed)` 같은 시드 PRNG로 ±2mm 지터를 더해 검출기 노이즈를 흉내 냅니다. `Math.random()` 금지.

### 8.3 앞차기가 "진짜처럼" 보이는 최소 요건

이걸 빠뜨리면 사람이 보자마자 가짜인 걸 압니다. 그리고 PRD 규칙 B가 바로 이 구조를 채점합니다.

1. **접었다 편다.** 고관절이 먼저 굽어 무릎이 올라오고(챔버), 그 다음에 무릎이 펴집니다. 고관절과 무릎이 **동시에** 펴지면 다리를 휘두르는 것처럼 보이고, 규칙 B1(순서 위반)의 음성 케이스도 만들 수 없습니다.
2. **회수.** 최대 신전 뒤 무릎을 **다시 접고** 나서 내립니다. 이게 앞차기와 단순 다리 들기를 가르는 지점이고 규칙 B2가 잡는 지점입니다.
3. **축발 회전.** 골반이 돌고 축발이 따라 돌아갑니다. 없으면 인형처럼 보입니다.
4. **몸통 반대 기울기.** 차는 다리 반대쪽으로 상체가 조금 젖혀집니다(규칙 B5의 경계가 여기 걸립니다 — 15°/25°). 0°로 두면 B5를 시험할 수 없습니다.
5. **시간 비대칭.** 뻗기는 빠르고(ease-out) 회수·내리기는 느립니다. 국면 길이를 다르게 주세요.
6. **팔 가드 유지.** 팔이 몸 옆에 늘어져 있으면 태권도로 안 보입니다.

국면: 준비 → 챔버 → 뻗기 → 회수 → 내리기. PRD 규칙 B의 상태 S1/S2/S4와 그대로 대응시키면 생성기와 판정기가 같은 언어를 쓰게 됩니다.

### 8.4 만들어야 할 샘플

PRD F1이 "3종 이상"이므로 최소 다음을 권합니다.

| 파일 | 목적 |
|---|---|
| `stance-good` | 주춤서기 합격 — A1~A5 전부 통과 |
| `stance-narrow` | 발 간격 부족 — A1이 0.1 또는 0.3을 물도록 |
| `frontkick-good` | 앞차기 합격 |
| `frontkick-no-retract` | 회수 생략 — **B2를 발화시키는 음성 케이스** |
| `frontkick-occluded` | 특정 구간 `visibility`를 0.3으로 깎음 — **H1/H2 보류 경로** |
| `frames-dropped` | 프레임을 솎아 간격 > 120ms — **H3 보류 경로** |

뒤 두 개는 좋은 샘플에서 **후처리로 파생**시키세요(생성기를 다시 돌릴 필요 없이 `degrade(sample, opts)` 한 함수면 됩니다). PRD F5의 완료 기준이 정확히 이 형태입니다.

크기 감각: 33개 × (x,y,z,visibility) × 30fps × 3초 ≈ 12k 숫자. 소수점 4자리로 자르면 JSON 약 250KB, gzip 후 훨씬 작습니다. 저장소에 넣고 골든 테스트를 돌리기에 충분합니다. **좌표는 반드시 반올림해서 고정**하세요(예: 1e-4) — 부동소수점 끝자리가 흔들리면 골든 스냅샷이 플랫해집니다.

---

## 9. LLM(F9) — 정적 배포와 양립시키는 법

0절 (가)에서 적었듯 `output: 'export'`에서는 런타임 서버 라우트가 없습니다. 선택지:

| 안 | 내용 | 평가 |
|---|---|---|
| **A. 빌드타임 생성 + 규칙 폴백** | `scripts/generate-commentary.ts`를 **사람이 수동 실행**해 샘플별 코멘트를 JSON으로 만들어 커밋. 런타임은 그 JSON을 읽고, 없으면 규칙 기반 템플릿 문장 | **권장.** 런타임에 키가 존재하지 않음 → 원칙 4가 구조적으로 보장됨. 결정적. 저장소에 LLM 호출 코드가 남아 역량도 보임 |
| B. 규칙 기반 템플릿만 | LLM 없음 | 가장 안전하지만 공고의 LLM API 항목을 못 보여 줌 |
| C. 사용자 키 입력(BYO) | 브라우저에서 키 받아 직접 호출 | 키가 브라우저 메모리·네트워크에 노출. 심사용 데모에 권하지 않음 |
| D. Vercel 등 서버 호스트 | 진짜 Route Handler 사용 | F8(정적 배포) 포기. Pages 병행하려면 빌드 2종이 필요해 복잡 |

**A로 가면** `.env.local`(gitignore)에 키를 두고 스크립트에서만 읽습니다. 커밋되는 것은 생성된 문장 JSON뿐입니다. README에 "이 문장들은 빌드 전에 생성되어 커밋되었고, 앱은 런타임에 어떤 외부 API도 호출하지 않습니다"라고 적으면 원칙 4가 명확해집니다.

A를 택하면 PRD F9의 문구를 고쳐야 합니다("서버 라우트 + 환경변수" → "빌드타임 스크립트 + 환경변수, 런타임 호출 없음"). 완료 기준의 "저장소에 비밀값 없음"은 그대로 유효합니다.

스크립트에서 쓸 모델 ID·요금은 이 문서에서 단정하지 않았습니다. 작성 시점에 `claude-api` 레퍼런스로 확인하세요.

---

## 10. 설치 명령 (확정)

```bash
npx create-next-app@15.5.25 . --ts --app --no-src-dir --no-tailwind --eslint \
  --use-npm --import-alias "@/*"

npm i @mediapipe/tasks-vision@1.0.1 three@0.186.0
npm i -D @types/three@0.186.0 vitest@3.2.7
```

`--no-tailwind`는 취향입니다. 규칙 표와 감점 카드가 화면의 대부분이므로 Tailwind가 있으면 빠르긴 합니다 — 넣을 거면 scaffold 시점에 넣는 편이 낫습니다(나중에 붙이면 설정이 늘어납니다).

---

## 11. 검증되지 않은 채 남은 것

정직하게 적습니다. 아래는 이 실사에서 **확인하지 못했던** 항목이고, 구현 중에 닫힌 것은 닫혔다고 표시했습니다.

- ~~**`worldLandmarks`의 축 방향과 부호**(y가 위인지 아래인지). 빈 이미지로는 포즈가 0개라 확인 불가였습니다.~~ → **닫힘(설계로).** 추측해 상수에 박는 대신, 입력 계층이 첫 검출에서 실측해 맞춰 넣도록 했습니다(`src/pose/landmarker.ts` 의 `detectYSign` — 코와 발목의 y를 비교). 판정 코어는 "y가 아래로 증가한다"는 가정 한 줄(`HEIGHT_SIGN`)만 알고, 모델이 바뀌어도 고칠 곳이 없습니다. 다만 **이 분기가 실제 검출로 실행되는 것은 아직 못 봤습니다**(아래 참조).
- **실기기 웹캠 경로 전체.** 개발 환경에 카메라가 없어 `detectYSign`·GPU/CPU 폴백·모델 내려받기 타임아웃이 실제 검출로 확인되지 않았습니다. 샘플 모드는 추론을 아예 건너뛰므로 판정 결과에는 닿지 않습니다.
- **`landmarks`와 `worldLandmarks`의 각도 일치도.** 규칙은 world 로만 계산하기로 정해 이 비교가 필요 없어졌습니다(3.4절). 실제 포즈에서 두 방식의 무릎각이 얼마나 다른지는 여전히 미확인입니다.
- **실제 사람의 앞차기에서 lite 모델의 발목·발끝 안정성.** B3(높이)·B6(축발 흔들림)이 발 랜드마크에 의존하는데, 빠른 동작에서 발이 흐려지면 lite 로는 불안정할 수 있습니다. 불안정하면 `full`(9.0MB)로 올리는 판단이 필요합니다.
- 모바일 사파리에서의 WASM·getUserMedia 동작.
- **GitHub Pages 실배포.** 워크플로(`.github/workflows/deploy.yml`)는 4.2절 그대로 만들어 두었지만, 저장소가 아직 비공개라 실제로 돌려 본 적은 없습니다. Pages 를 켜고(Settings → Pages → Source: GitHub Actions) 첫 푸시가 도는 것이 마지막 확인입니다.

---

## 12. 따라하기 게임 · 교본 오버레이 · 결과 카드 — 2차 기술 실사

작성 2026-09-24 · 검증 환경 macOS 26.5.1(darwin 25.5.0, arm64), node v23.11.0, Chromium 152.0.7977.130, `devicePixelRatio` 2, **120Hz 디스플레이(프레임 예산 8.3ms)**

대상은 `docs/PRD-game.md` 5절의 세 기능입니다. 아래 숫자는 전부 오늘 실제로 돌려 얻은 값입니다. 브라우저 실험은 스크래치 폴더에서 `http://localhost` 로 띄운 실험 페이지에서, 판정 코어 실험은 **저장소를 그대로 복제한 스크래치 사본**에서 `vitest` 로 돌렸습니다. **저장소 소스는 한 줄도 건드리지 않았습니다.** 확인하지 못한 것은 12.7에 따로 적었습니다.

이 절은 규칙을 바꾸지 않습니다. 규칙과 부딪히는 지점을 찾아내는 것이 목적이고, 실제로 **PRD와 부딪히는 항목 두 개**(12.0 ㄱ, 12.1 ㄷ)를 찾았습니다. 그것부터 적습니다.

### 12.0 먼저 볼 것 — PRD와 부딪히는 항목 2개

#### (ㄱ) "두 스켈레톤을 각자의 어깨 폭 S로 나눈다"(PRD 5.3)는 **측면 코스에서 성립하지 않는다**

S(`shoulderWidth`)는 **3차원 거리**입니다(`src/judge/coords.ts` 주석이 이미 그 이유를 적어 두었습니다). 그런데 오버레이는 **화면 평면**에 그립니다. 측면 촬영에서는 두 어깨가 깊이 방향으로 겹치므로 **화면 위 어깨 폭이 0에 수렴합니다.** 실측:

| 샘플 | 각도 | 화면평면 어깨폭(m) | 화면평면 몸통길이(m) | S(3D, m) |
|---|---|---|---|---|
| `stance-good` | 정면 | 0.4371 ~ 0.4435 | 0.4862 ~ 0.4920 | 0.4371 ~ 0.4435 |
| `stance-narrow` | 정면 | 0.4367 ~ 0.4439 | 0.4869 ~ 0.4925 | 0.4367 ~ 0.4439 |
| `frontkick-good` | 측면 | **0.0002 ~ 0.0041** | 0.4869 ~ 0.4926 | 0.4369 ~ 0.4434 |
| `frontkick-underextended` | 측면 | **0.0002 ~ 0.0041** | 0.4874 ~ 0.4925 | 0.4369 ~ 0.4436 |
| `frontkick-occluded` | 측면 | **0.0002 ~ 0.0041** | 0.4869 ~ 0.4926 | 0.4369 ~ 0.4434 |

`frontkick-good` 중간 프레임에서 화면평면 어깨폭 ÷ S(3D) = **0.0029**. 화면 위 어깨 폭으로 교본을 정규화하면 교본이 **약 340배로 부풀어** 캔버스 밖으로 날아갑니다. 최소값 0.0002에서는 2000배가 넘습니다.

S(3D)로 나누면 숫자는 안 터지지만(정면·측면 모두 0.437~0.444로 안정) **깊이(z)에 기댄 길이로 화면 평면 좌표를 나누는 것**이 됩니다. 단일 카메라의 z는 상대값이라(3.4절), 사람이 한 걸음 앞뒤로 움직이면 교본만 커졌다 작아집니다.

**두 시야 모두에서 화면 평면에 놓이는 길이는 몸통(어깨중점→엉덩이중점) 하나뿐입니다.** 실측 변동폭이 정면 0.4862~0.4925, 측면 0.4869~0.4926 — **두 시야를 합쳐 ±1.5% 안**입니다. `coords.ts` 의 `shoulderWidth` 주석이 이미 "깊이에 덜 기대는 대안은 몸통 길이"라고 적어 둔 그 값입니다.

→ **결론: 오버레이의 정규화 기준은 화면평면 몸통 길이로 한다.** 판정의 S는 그대로 둡니다. 규칙은 S를 쓰고 그림은 몸통을 쓰는 것이 두 벌이 아닌 이유는, **하나는 채점 단위이고 하나는 화면 배율이기 때문**입니다. PRD 5.3의 "어깨 폭 S로 나눈다"는 이 값으로 바꿔 적어야 하고, 화면 어딘가에 "그림 배율 기준 = 몸통 길이"라고 한 줄 드러내는 편이 정직합니다.

#### (ㄴ) H3(120ms)는 게임 루프를 **직접 죽인다** — 연속 3프레임만 빠져도 그 라운드는 보류

`WITHHOLD.maxFrameGapMs = 120`. 30fps에서 프레임 간격은 33.3ms입니다. 스크래치 사본에서 `stance-good` 의 프레임을 일부러 지워 가며 `judgeSequence` 를 돌린 실측:

| 연속 결손 | 실제 간격 | 결과 |
|---|---|---|
| 0프레임 | 33ms | 점수 10 |
| 1프레임 | 67ms | 점수 10 |
| 2프레임 | 100ms | 점수 10 (보간으로 메움) |
| **3프레임** | **133ms** | **보류 H3** |
| 4프레임 | 167ms | 보류 H3 |

판정 코어가 내놓은 문장 그대로: `프레임 19와 20 사이가 233ms 비었다(기준 120ms). 그 사이에 동작의 어느 부분이 있었는지 알 수 없다.`

즉 **맞추기 단계에서 메인 스레드가 120ms 넘게 멈추면 그 라운드는 점수가 아니라 보류로 끝납니다.** 아래에서 잰 것 중 이 문턱을 넘는 것이 실제로 있습니다 — `ctx.filter` 블러(433ms/프레임, 12.5), **첫 PNG 인코딩(콜드 1078ms, 12.1)**, 탭 전환(단일 공백 1500ms, 12.4). 게임 루프의 성능 문제는 "좀 버벅인다"가 아니라 **"점수가 사라진다"** 입니다. 이 절의 모든 권고는 이 한 줄에서 나옵니다.

---

### 12.1 캔버스 → PNG 내보내기

#### (ㄱ) 크기·시간 실측 (중앙값 3회, 워밍업 후)

| 논리 크기 | 배율 | 실픽셀 | `toBlob` PNG | PNG 크기 | `toDataURL` | data URL 문자열 | JPEG q0.92 | JPEG 크기 |
|---|---|---|---|---|---|---|---|---|
| 1080×1350 | 1x | 1080×1350 | 12.6ms | 294 kB | 10.9ms | 391 kB | 7.3ms | 75 kB |
| 1080×1350 | **2x** | **2160×2700** | **25.5ms** | **921 kB** | 25.5ms | 1227 kB | 19.7ms | 215 kB |
| 1080×1350 | 3x | 3240×4050 | 53.3ms | 1898 kB | 51.4ms | 2531 kB | 40.2ms | 385 kB |
| 720×900 | 2x | 1440×1800 | 16.4ms | 519 kB | 12.5ms | 692 kB | 8.8ms | 169 kB |

실제 카드(배경 그러데이션 + 스켈레톤 2벌 + 한글 6줄 + 감점 3행)를 2160×2700으로 그려 본 결과 **671 kB**. 그리는 시간은 3.7ms입니다 — 비용은 전부 인코딩입니다.

**2x를 권합니다.** 3x는 파일이 2배가 되면서 눈에 보이는 차이가 없고, 1x는 한글 획이 뭉갭니다. PNG를 권하는 이유는 카드가 단색 면과 선으로만 이루어져 PNG가 유리하고(JPEG는 어두운 배경 위 얇은 선에 블록 노이즈가 붙습니다), 무엇보다 **결정적**이기 때문입니다 — 같은 판정이면 같은 바이트가 나옵니다.

- 문서: <https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob>
- `toBlob(callback, type, quality)` 는 값을 반환하지 않고(`undefined`) 콜백으로 `Blob | null` 을 줍니다. **`null` 분기를 반드시 적으세요.**
- `image/png` 만 전 브라우저 필수 지원입니다. `image/jpeg`·`image/webp` 는 "많은 브라우저가 지원"일 뿐입니다. 지원하지 않는 타입을 주면 조용히 PNG로 나옵니다 — **그래서 `blob.type` 을 확인하지 않으면 `.jpg` 이름을 붙인 PNG를 내보내게 됩니다.**

#### (ㄴ) 배율은 `devicePixelRatio` 로 정하지 말 것

`Stage.tsx` 의 `setupCanvas` 는 화면 표시용이라 `Math.min(devicePixelRatio, 2)` 가 맞습니다. **카드는 반대입니다.** DPR로 배율을 정하면 같은 판정이 노트북에서 2160px, 외장 모니터에서 1080px로 나와 파일이 기기마다 달라집니다. 이 프로젝트가 "같은 입력이면 같은 결과"를 내세우는 이상, 카드도 **고정 배율 2**로 그려야 합니다. DPR은 카드 렌더러에 들어가면 안 됩니다.

#### (ㄷ) **PRD와 부딪힘 — 첫 인코딩이 1초 넘게 메인 스레드를 잡는다**

첫 실험 회차의 맨 처음 `toDataURL` 한 번이 **1077.6ms** 였고, 같은 캔버스의 두 번째 호출부터는 10~30ms 대로 떨어졌습니다(워밍업 후 중앙값 표는 위 (ㄱ)). 인코더 초기화 비용입니다. 판정이 끝난 뒤 카드를 뽑는 것뿐이면 상관없지만, **웹캠 기록기가 도는 동안 인코딩하면 12.0(ㄴ)의 H3이 바로 걸립니다.**

세 가지를 같이 씁니다.

1. **기록기를 먼저 멈춘다.** 카드는 라운드가 다 끝난 뒤 뽑는 물건이므로 이게 근본 해법입니다.
2. **워밍업.** 게임 시작 버튼을 누를 때 1×1 캔버스로 `toBlob` 을 한 번 돌려 인코더를 깨워 둡니다(측정상 1ms 미만).
3. **정말 도중에 뽑아야 하면 워커로 보낸다.** `OffscreenCanvas.convertToBlob` 이 워커에서 동작하는 것을 실측했습니다 — 2160×2700 PNG **워커 안 인코딩 88.4ms, 왕복 98.4ms, 337 kB**, `Blob` 이 구조적 복제로 그대로 넘어옵니다. **메인 스레드는 비어 있으므로 H3이 걸리지 않습니다.**

```ts
// 워커 쪽 (문자열로 만들어 Blob URL 로 띄우면 정적 내보내기에서도 파일이 늘지 않는다)
self.onmessage = async (e) => {
  const { w, h } = e.data;
  const oc = new OffscreenCanvas(w, h);
  const cx = oc.getContext("2d")!;
  /* … 카드 그리기 … */
  const blob = await oc.convertToBlob({ type: "image/png" });
  self.postMessage({ blob });          // Blob 은 구조적 복제로 넘어간다
};
```

실측 확인: 워커 안에서도 **한글이 정상으로 그려집니다**(12.2 (ㄷ)). 워커에는 `document` 가 없으므로(`typeof document === "undefined"` 확인) 글꼴 스택을 문자열로 넘겨야 하고, `document.fonts` 대신 `self.fonts` 를 씁니다.

#### (ㄹ) 파일명과 내려받기

저장소에 이미 `downloadText`(`src/pose/transfer.ts`)가 있고 구조가 그대로 맞습니다 — `Blob` → `createObjectURL` → `<a download>` → `click()`. 카드용은 텍스트가 아니라 `Blob` 을 받는 형제 함수(`downloadBlob`)로 두면 됩니다.

**다만 `revokeObjectURL` 의 위치는 위험합니다.** 현재 코드는 `finally` 에서 `click()` 직후에 취소합니다. 실측: `URL.revokeObjectURL(u)` 가 돌아온 **바로 그 순간** URL이 죽습니다 — 같은 마이크로태스크 안에서 `fetch(u)` 를 해도 `TypeError` 입니다.

```
fetch 취소 전        → true
fetch 취소 후        → ERR:TypeError
fetch 취소 후(마이크로태스크) → ERR:TypeError
```

크롬은 `click()` 디스패치 중에 blob 을 동기적으로 붙잡으므로 지금까지 300바이트짜리 JSON에서는 아무 일도 없었습니다. 900 kB PNG로 올라가고 사파리·모바일까지 가면 기댈 만한 성질이 아닙니다. **취소는 다음 태스크로 미루세요** — `setTimeout(() => URL.revokeObjectURL(url), 60_000)` 또는 `pagehide` 에서. 파일명은 `download` 속성 그대로 갑니다(`/`·`\` 는 `_` 로 치환됨). `download` 는 동일 출처 URL이거나 `blob:`·`data:` 스킴에서만 동작합니다 — 우리는 `blob:` 이라 해당 없습니다. 문서: <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a>

#### (ㅁ) 모바일 사파리 — **`navigator.share` 를 기본 경로로 두지 말 것**

PRD 5.4는 "`navigator.share` 가 있으면 먼저 시도"라고 적었습니다. 이 맥의 크로미움 실측은 `navigator.share` = **false**, `navigator.canShare` = **false** 입니다. 즉 데스크톱에서는 그 가지가 아예 안 열립니다. 그리고 `share` 는 **보안 컨텍스트(HTTPS) + 일시적 활성화(사용자 클릭) + `web-share` 권한 정책**을 전부 요구하고, 파일 공유는 MDN이 "제한적 지원, Baseline 아님"이라고 명시합니다. 문서: <https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share>

```ts
// 순서가 중요하다: share 는 '있으면 더 좋은 것'이지 기본 경로가 아니다
const file = new File([blob], name, { type: "image/png" });
if (navigator.canShare?.({ files: [file] })) {
  try { await navigator.share({ files: [file], title: "품새 판정 결과" }); return; }
  catch { /* 사용자가 취소한 것도 여기로 온다 — 조용히 내려받기로 떨어진다 */ }
}
downloadBlob(name, blob);
```

`share()` 는 반드시 클릭 핸들러 **안에서 동기적으로 이어지는 흐름**에 있어야 합니다. `await toBlob(...)` 을 먼저 하면 활성화가 만료돼 거절될 수 있으므로, **blob 을 먼저 만들어 두고 버튼을 활성화하는 편**이 안전합니다. iOS에서는 `a[download]` 가 다운로드 대신 새 창/미리보기로 열리는 사례가 알려져 있는데, **이 환경에 iOS 기기가 없어 확인하지 못했습니다**(12.7). 그래서 카드 화면에는 "이미지를 길게 눌러 저장"이라는 한 줄과 `<img>` 미리보기를 같이 두는 편이 안전합니다 — 미리보기는 어차피 필요합니다. `navigator.clipboard.write` 는 이 환경에서 **true** 라, 복사 버튼은 보조 경로로 쓸 수 있습니다.

---

### 12.2 한글 글꼴 — 외부 폰트 없이

#### (ㄱ) `document.fonts.check()` 는 **글꼴 설치 여부를 알려 주지 않는다**

가장 흔한 함정이라 먼저 적습니다. 실측 — 존재할 리 없는 이름에도 `true` 가 나옵니다.

| 지정한 글꼴 | `document.fonts.check()` | 한글 문자열 폭 |
|---|---|---|
| `system-ui` | true | 393.37 |
| `-apple-system` | true | 398.93 |
| `"Apple SD Gothic Neo"` | true | 398.93 |
| `"Noto Sans KR"` | true | 398.93 |
| `"Malgun Gothic"` | true | 398.93 |
| `"Nanum Gothic"` | true | **432.96** |
| **`"__NoSuchFont_12345__"`** | **true** | **398.93** |
| `sans-serif` | true | 398.93 |

MDN이 명시합니다 — `check()` 는 "이 `FontFaceSet` 안의 글꼴 중 아직 로드되지 않은 것을 쓰게 되는가"만 봅니다. 시스템 글꼴은 `FontFaceSet` 에 없으므로 언제나 `true` 입니다. <https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/check>

**폭 비교(고전적인 글꼴 탐지 기법)도 한글에서는 안 먹힙니다.** 위 표에서 존재하지 않는 이름과 `sans-serif` 와 `"Apple SD Gothic Neo"` 의 폭이 **전부 398.93으로 같습니다** — 지정한 라틴 글꼴에 한글 글리프가 없으면 어차피 같은 시스템 한글 글꼴로 떨어지기 때문입니다. 폭이 갈린 것은 한글 글리프를 **자기가 가진** `Nanum Gothic` 하나뿐이었습니다(이 맥에 실제로 설치돼 있음).

#### (ㄴ) 그래서 무엇을 재야 하나 — 두부(tofu) 픽셀 검사

알고 싶은 것은 "어떤 글꼴인가"가 아니라 **"한글이 네모 상자로 나오는가"** 입니다. 그건 잴 수 있습니다. 사용자 영역 문자(U+E000)는 어떤 글꼴에도 글리프가 없어 반드시 두부로 그려지므로, 한글 한 글자를 같은 조건으로 그려 비교하면 됩니다.

```ts
/** 한글이 네모 상자로 떨어지는 환경인가. 60×60 캔버스 두 번, 1ms 미만. */
export function hangulRenders(fontStack: string): boolean {
  const cv = document.createElement("canvas");
  cv.width = 60; cv.height = 60;
  const cx = cv.getContext("2d", { willReadFrequently: true })!;
  const ink = (t: string) => {
    cx.fillStyle = "#000"; cx.fillRect(0, 0, 60, 60);
    cx.fillStyle = "#fff"; cx.font = `700 40px ${fontStack}`;
    cx.textBaseline = "middle"; cx.fillText(t, 2, 30);
    const d = cx.getImageData(0, 0, 60, 60).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 32) n += 1;
    return n;
  };
  const hangul = ink("한");
  const tofu = ink("");
  return Math.abs(hangul - tofu) > tofu * 0.1;   // 두부와 확연히 다르면 진짜 글리프
}
```

이 맥 실측: `한` = 705px, `` = 1172px → `true`. 워커 안에서도 같은 검사가 동작합니다(아래 (ㄷ)).

**최악의 경우 대비.** `false` 면 글자 대신 도형으로 갑니다 — 이건 이 프로젝트에 특히 잘 맞습니다. 카드에서 한글로만 말하는 것은 동작 이름·항목 이름·면책 한 줄뿐이고, **점수·측정값·경계값은 전부 숫자와 기호**(`9.4`, `142.6°`, `≤ 140°`, `1.48·S`)라 라틴 글리프만으로 그려집니다. `false` 일 때는 (1) 동작 이름을 규칙 ID(`A1`~`A5`, `B1`~`B7`)로 대체하고, (2) 항목 이름 자리에 그 항목이 읽는 관절을 미니 스켈레톤 아이콘으로 찍고, (3) 카드 하단에 `poomsae-judge` 한 줄(라틴)을 남기면 **카드가 여전히 판정서로 읽힙니다.** 아무것도 안 하면 네모 상자가 박힌 이미지가 심사위원 손에 갑니다.

#### (ㄷ) 쓸 글꼴 스택

```
system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif
```

- **내려받는 것이 0입니다.** 웹폰트를 안 쓰므로 `document.fonts.ready` 를 기다릴 필요도, FOUT 도 없습니다. 첫 프레임부터 바로 그려집니다.
- 기기마다 **다른 글꼴로 그려집니다.** 맥은 Apple SD Gothic Neo 계열, 윈도는 맑은 고딕, 안드로이드는 Noto Sans CJK. **그래서 같은 카드가 기기마다 글자 폭이 다릅니다.** 이건 고칠 수 없고, 아래 (ㄹ)처럼 설계로 흡수해야 합니다.
- 워커 실측(같은 스택, 48px): 한글 4자 폭 166.1(글자당 0.865em, 잉크 3301) / 라틴 4자 폭 133.1(0.69em) / 두부 4자 폭 193.4(1.0em, 잉크 6396). 즉 **워커에서도 실제 한글 글리프가 나옵니다.**

#### (ㄹ) 함정 — 좌표를 손으로 박으면 다른 기기에서 글자가 겹친다

실제로 당했습니다. 카드 시안에서 `9.4` 를 200px로 찍고 그 옆 `점 / 10.0` 을 `x = 340` 에 박았더니, 이 맥에서는 두 글자가 겹쳤습니다.

**글자 옆에 글자를 놓을 때 x 를 상수로 쓰지 마세요.** 언제나 앞 글자의 실측 폭에서 이어 붙입니다. 이 프로젝트에서는 특히 위험합니다 — 카드의 거의 모든 줄이 `측정값 + 경계값` 쌍이고, 그 쌍이 겹치면 "점수 옆에 언제나 측정값과 경계값"이라는 약속이 **글자가 겹쳐 안 읽히는 형태로** 깨집니다.

```ts
const w = cx.measureText(head).width;
cx.fillText(tail, x + w + GAP, y);               // 상수 x 금지

// 세로 정렬: 한글은 actualBoundingBox 로 가운데를 잡아야 한다
const m = cx.measureText(label);
const cy = boxY + boxH / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
```

실측(64px, 위 스택): `주춤서기 9.4점` → 폭 388.0, `actualBoundingBoxAscent` 52.0 / `Descent` 5.1, `fontBoundingBoxAscent` 62.0 / `Descent` 14.0. **줄 간격은 76px ≈ 1.19em** 이 최소이고, 라틴 기준 1.2em 을 그대로 쓰면 받침이 아랫줄에 닿습니다. **1.5em 을 권합니다.**

그리고 **캔버스에는 자동 줄바꿈이 없습니다.** 다행히 한글은 어절 단위가 아니라 글자 단위로 끊어도 읽히므로, 한 글자씩 더하며 `measureText` 로 재는 단순한 래퍼로 충분합니다(영문 단어 단위 래퍼처럼 복잡할 필요가 없습니다). 다만 숫자·단위(`142.6°`)는 끊기면 안 되므로 **분리 금지 토큰**으로 묶어 두세요.

`ctx.letterSpacing` 은 이 환경에서 동작하지만(실측 true) 지원이 고르지 않으니 쓰지 않습니다.

---

### 12.3 스켈레톤 오버레이 — 기존 렌더러에 교본을 얹기

#### (ㄱ) 지금 구조

`src/pose/draw2d.ts` 의 `drawPose(ctx, w, h, opts)` 는 캔버스를 통째로 다시 그립니다. 좌표는 `frame.image`(0~1 정규화 이미지 좌표)를 쓰고, 파일 머리말이 **"각도 계산에는 절대 쓰지 않는다"** 고 못 박아 두었습니다. 색은 `DrawTheme` 7개, 강조 관절은 `emphasis: readonly number[]` 입니다. **교본을 얹는 가장 단순한 방법은 `drawPose` 를 고치는 것이 아니라 `DrawOptions` 에 교본 레이어를 옵션으로 하나 더 받는 것**입니다 — `mirror` 변환이 `drawPose` 안에서 한 번 걸리므로, 밖에서 따로 그리면 (ㄹ)의 함정에 그대로 걸립니다.

#### (ㄴ) 교본을 같은 좌표계에 놓는 법 — `projectFrames` 를 **다시 부르면 안 된다**

`src/pose/sequence.ts` 의 `projectFrames(worldFrames, aspect)` 는 **시퀀스 전체의 경계상자**를 재어 배율을 정합니다(`viewHeight = max(height/0.84, width/(0.84·aspect))`). 즉 배율이 **그 시퀀스에 따라 다릅니다.** 실측:

| 샘플 | world→image 배율 `sx` |
|---|---|
| `stance-good` | 0.37296 |
| `stance-narrow` | 0.37336 |
| `frontkick-good` | 0.37234 |
| `frontkick-balance-broken` | 0.37234 |

교본만 따로 `projectFrames` 에 넣으면 교본의 경계상자로 배율이 정해져, **같은 자세를 줘도 내 스켈레톤과 팔다리 길이가 다르게 그려집니다.** 샘플들끼리 차이가 작아 보이지만(0.3%) 그건 샘플이 다 비슷해서일 뿐이고, 교본은 한 프레임짜리라 경계상자가 완전히 다릅니다.

**정답은 내 프레임에서 변환을 복원하는 것입니다.** 모든 `PoseFrame` 은 `world` 와 `image` 를 나란히 들고 다니고, 둘 사이는 축별 배율이 다른 **아핀 변환**입니다. 그래서 아무 랜드마크 두 개로 계수를 역산할 수 있습니다.

```ts
/** 이 프레임이 실제로 쓴 world→image 변환을 프레임 자신에게서 복원한다. */
function imageMapOf(f: PoseFrame, a = LM.leftShoulder, b = LM.rightShoulder) {
  const sx = (f.image[a].x - f.image[b].x) / (f.world[a].x - f.world[b].x);
  const sy = (f.image[a].y - f.image[b].y) / (f.world[a].y - f.world[b].y);
  return {
    sx, sy,
    ox: f.image[a].x - f.world[a].x * sx,
    oy: f.image[a].y - f.world[a].y * sy,
  };
}
```

실측 검증(`stance-good` 중간 프레임):

- 어깨·발목·엉덩이–무릎·코–발목 **어느 쌍으로 뽑아도 계수가 같습니다** (`sx` = 0.372958, `sy` = 0.497277, 소수 6자리까지 일치).
- 복원한 계수로 **33개 점 전부를 재투영했을 때 최대 오차 1.987e-14** (정규화 단위). 720px 캔버스에서 **1.4e-11 px** — 부동소수점 바닥입니다.
- `sx / sy` = **0.750000**, `1 / aspect` = 0.750000 (aspect 4:3). 정확히 일치합니다.

즉 교본을 world 좌표로 만들어(`src/samples/rig.ts` 가 이미 world 를 냅니다) → 몸통 길이로 배율을 맞추고 엉덩이 중점으로 옮긴 뒤 → **내 프레임에서 복원한 같은 변환**을 태우면, 두 스켈레톤이 정확히 같은 자에 놓입니다. 새 상수도, 카메라 모델도 필요 없습니다.

#### (ㄷ) `sx ≠ sy` 다 — **이미지 좌표에서 각도를 재면 최대 15° 틀린다**

위에서 `sx / sy = 1 / aspect` 였다는 것은 **이미지 좌표계가 x 방향으로 눌려 있다**는 뜻입니다. 그래서 (1) **교본을 이미지 좌표에서 등방 배율로 키우면 안 되고**(world 에서 키운 뒤 투영해야 합니다), (2) **각도 차이를 화면에 그려진 좌표로 계산하면 안 됩니다.**

11절이 미확인으로 남겨 둔 "`landmarks` 와 `worldLandmarks` 의 각도 일치도"를 합성 샘플에 한해 실측했습니다(4:3). 같은 무릎 내각을 두 좌표계에서 잰 최대 차:

| 샘플 | 최대 차 | 그때 값 |
|---|---|---|
| `stance-good` | **8.14°** | world 137.0° / image 145.1° |
| `frontkick-good` | **13.20°** | world 129.5° / image 116.3° |
| `frontkick-underextended` | **15.23°** | world 115.0° / image 99.8° |

PRD 5.3이 정한 표시 문턱이 **6°/15°** 입니다. 좌표계를 잘못 고르면 **오차 하나가 등급 한 칸을 통째로 넘깁니다.** 특히 `frontkick-underextended` 는 world 115.0°(B4 major 대역)가 image 에서 99.8°로 보여, 화면의 빨강과 판정의 빨강이 **서로 다른 관절을 가리키게 됩니다.** PRD가 "오버레이의 빨강과 판정 카드의 빨강이 대체로 같은 관절을 가리킨다"고 약속한 바로 그 지점이 깨집니다.

→ **각도 차이는 반드시 `world` 로 계산하고, `image` 는 점을 찍는 데만 쓴다.** 이미 있는 `kneeAngle`·`torsoTilt`(`src/judge/coords.ts`)를 그대로 부르면 됩니다. 새 수학을 쓰지 마세요.

#### (ㄹ) 거울 반전 — 두 가지가 동시에 틀리기 쉽다

`drawPose` 는 `opts.mirror` 일 때 `ctx.translate(width, 0); ctx.scale(-1, 1)` 을 **`ctx.save()` 안쪽 맨 앞에서** 겁니다. 함정 둘:

1. **교본을 `drawPose` 밖에서 따로 그리면 거울을 안 탑니다.** 내 스켈레톤만 뒤집히고 교본은 안 뒤집혀, 웹캠 모드에서 **모든 관절이 최대로 어긋난 것처럼 빨개집니다.** → 교본은 반드시 같은 `save()/restore()` 구간 안에서 그립니다.
2. **캔버스를 뒤집어도 랜드마크 번호는 안 바뀝니다.** `LM.leftKnee` 는 여전히 사람의 왼무릎이고, 거울 화면에서는 **화면 오른쪽**에 있습니다. 라벨에 "왼무릎"이라고 쓰면 화면 오른쪽을 가리키는 글자가 됩니다 — 사용자가 보기엔 맞습니다(거울이니까). 하지만 **글자 자체는 뒤집혀 그려집니다.** `scale(-1,1)` 안에서 `fillText` 하면 한글이 좌우 반전됩니다.

```ts
// 라벨은 거울 변환 밖에서, 좌표만 손으로 되접어 그린다
const sx = mirror ? width - x : x;
ctx.restore();                 // 거울 해제 후
ctx.fillText(`${name} +${diff.toFixed(1)}°`, sx + 14, y);
```

PRD 5.3이 "거울 변환은 그리기 직전 한 번만 적용하므로 교본도 같이 탄다"고 적은 것은 맞지만, **라벨은 예외**라는 한 줄이 빠져 있습니다.

#### (ㅁ) 엉덩이 중점은 정렬 기준으로 쓸 수 있다

world 좌표의 원점이 엉덩이 중점이라는 약속이 실제로 지켜지는지 실측했습니다.

| 샘플 | 첫 프레임 hipMid (x, y) | 중간 프레임 hipMid |
|---|---|---|
| `stance-good` | (−0.0015, 0.0002) | (−0.0006, −0.0014) |
| `frontkick-good` | (0.0003, −0.0009) | (−0.0002, 0.0001) |

전부 **±0.0015 m 안**(어깨폭의 0.3%)입니다. 즉 교본 정렬은 **배율 + 평행이동**만으로 끝나고, 평행이동은 사실상 0입니다. PRD 5.3의 "(2) 엉덩이 중점을 원점으로 맞춘다"는 실측으로 뒷받침됩니다. 웹캠 실검출에서도 같은지는 확인하지 못했습니다(12.7).

#### (ㅂ) 색 — 빨강 충돌은 "표현이 다르다"만으로는 얇다

현재 화면에서 빨강은 두 곳에 있습니다. `draw2d.ts` 의 `theme.weak = #ff7b72`(visibility < 0.5 인 관절, **점선**)와 `Skeleton3D.tsx` 의 `COLOR_FLAGGED = 0xff6b81`(감점·보류가 읽은 관절), 그리고 CSS `--bad = #f78787`.

PRD 5.3의 색 규약(점선 = 못 읽음 / 실선 = 읽음)은 논리적으로 맞고, "흐린 관절은 각도를 계산하지 않으므로 어긋남 등급을 받을 수 없다"는 구조적 배타도 맞습니다. **다만 실측 한 줄을 덧붙입니다** — 어두운 배경 위 5px 선에서 점선과 실선의 구분은 관절 근처에서 잘 안 보입니다. 시안을 그려 본 결과 **어긋남을 노랑(`--warn #f2c15b`)으로 두고 숫자 라벨을 붙였을 때가 가장 안 헷갈렸습니다**(위 카드 시안의 `오른무릎 +12.4°`). 최종 색 선택은 오너 몫이지만, 만약 15° 초과를 빨강으로 간다면 **범례를 상시 노출**하는 것이 조건이어야 합니다. 어느 쪽이든 **`theme.weak` 과 `--bad` 는 건드리지 마세요** — 기존 화면 전체의 의미가 따라 움직입니다.

---

### 12.4 게임 루프와 타이밍

#### (ㄱ) 배경 탭에서 rAF는 **느려지는 게 아니라 멈춘다**

MDN: "`requestAnimationFrame()` calls are paused in most browsers when running in background tabs" — <https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame>
크롬 공식 문서도 같은 말을 합니다: "requestAnimationFrame will wait for the page to be visible, so it doesn't use any CPU when the page is hidden." — <https://developer.chrome.com/blog/timer-throttling-in-chrome-88>

같은 글이 `setTimeout` 쪽 규칙도 정합니다. 숨은 지 5분이 넘고 체인 길이 5 이상이면 **분당 1회**까지 떨어집니다(intensive throttling). 참고로 이 환경에서 `setTimeout(t, 16)` 의 실측 주기는 **59.9Hz**, 같은 시간 rAF는 **115Hz** 였습니다 — **`setTimeout` 으로는 120Hz 화면의 루프를 못 돌립니다.**

**이 브라우저 패널에서는 탭을 뒤로 보내도 `visibilityState` 가 `visible` 로 남아 throttling 을 재현하지 못했습니다**(rAF 115Hz 유지, `visibilitychange` 미발화). 그래서 위 두 줄은 공식 문서 근거이고 로컬 실측이 아닙니다. 12.7에 적었습니다.

#### (ㄴ) 남은 시간은 **프레임을 세지 말고 시계로 재라** — 실측 1.49초가 사라진다

메인 스레드를 1.5초 막아 두고(탭 전환·긴 인코딩과 같은 상황) 프레임 수와 시계를 비교했습니다.

| 재는 방법 | 값 |
|---|---|
| `performance.now()` 차 | **2502ms** |
| `Date.now()` 차 | **2502ms** |
| 프레임 수 × (1000/120) | **1017ms** |
| 실제 프레임 수 | 122 |
| 최대 프레임 간격 | **1499.8ms** (100ms 넘는 공백은 이것 하나뿐) |

프레임을 세는 카운트다운이었다면 **없는 1.49초가 화면에 남습니다.** 그리고 **막힌 동안 밀린 rAF 콜백이 몰아서 오지 않습니다** — 공백 하나로 끝났습니다. "나중에 따라잡겠지"는 성립하지 않습니다.

```ts
// 라운드 시계: 시작 시각 하나만 들고 매 프레임 뺀다
const startedAt = performance.now();
const remainMs = Math.max(0, limitMs - (performance.now() - startedAt));
// 프레임을 세거나, 프레임마다 remain -= 16.7 하지 않는다
```

`rAF` 콜백이 받는 `timestamp` 를 쓰는 것이 더 좋습니다 — MDN: "이전 프레임 렌더링이 끝난 시각"이고 "한 프레임 안에서 여러 콜백이 불려도 모두 같은 timestamp 를 받습니다". `performance.now()` 를 콜백 안에서 새로 부르면 콜백마다 값이 달라져 같은 프레임의 두 그림이 다른 시각을 기준으로 그려집니다. **이 프로젝트에는 이미 같은 원칙이 있습니다** — `usePlayback.ts` 가 "시간의 기준은 `frame.t` 하나다"라고 적고 실제로 그렇게 합니다. 게임 시계도 같은 규율을 따르면 됩니다.

#### (ㄷ) 탭이 숨으면 **라운드를 무효로 하고 다시 시작한다**

12.0(ㄴ)에서 봤듯 120ms 공백이면 그 라운드는 어차피 H3 보류입니다. 탭 전환은 최소 수백 ms이므로 **자동으로 보류**가 됩니다. 그러면 사용자는 "왜 갑자기 0점이지"를 겪습니다. 그보다는 **명시적으로 무효 처리하고 다시 제시하는 편**이 정직합니다. `Studio.tsx` 에 이미 같은 패턴이 있습니다(숨으면 웹캠을 끕니다).

```ts
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") abortRound("화면을 벗어나 이 라운드를 다시 합니다");
});
```

문서: <https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API>

#### (ㄹ) 판정 창 21개 쓸기 — **공짜다**

PRD 5.1이 정한 "2.0초 창을 0.2초 보폭으로 밀며 각 창에 `judgeSequence`" 를 스크래치 사본에서 그대로 재현했습니다(180프레임 6초, 창 21개, 창당 61프레임).

| 측정 | 값 |
|---|---|
| 창 1개 `judgeSequence` | 중앙값 **0.050ms**, p95 0.063ms |
| **창 21개 전부** | 중앙값 **1.19ms** (최소 1.05 / 최대 1.76) |
| 6초 구간 통째로 1회 | 0.12ms |
| 점수가 나온 창 | 21 / 21, 점수 범위 9.9~10.0 |

**한 프레임(8.3ms) 안에 다 들어갑니다.** 워커도, 증분 계산도 필요 없습니다. 창을 21개가 아니라 100개로 늘려도 5ms 대입니다. PRD 5.1의 설계는 성능 근거로 지지됩니다.

주의 하나: 판정 코어는 **이미 스스로 창을 고릅니다**(`findStanceWindow` 가 `settledMinSeconds` 0.2초 이상 멈춘 가장 긴 구간을 찾고, 없으면 유효 프레임이 이어진 가장 긴 구간으로 물러섭니다). 그래서 게임이 하는 21회 쓸기는 **판정의 창 선택을 대체하는 것이 아니라 그 위에 한 겹 더 얹는 것**입니다. 이 이중 구조는 의도한 것이어야 하고, 화면의 "채택된 창" 표시는 **바깥 창(게임이 고른 2초)** 이 아니라 **판정이 실제로 읽은 구간**(`Judgement.frames.judgedFrom/judgedTo`)을 보여 줘야 합니다. 아니면 되감기 재생이 실제 채점 구간과 어긋납니다.

#### (ㅁ) 제한 시간 하한은 규칙에서 나온다 — PRD 4초와 맞음

`STANCE.minHoldSeconds` 0.8초(A5) + `STANCE.settledMinSeconds` 0.2초(H7) + 앉는 전이. 샘플 시퀀스 실측으로 감을 더합니다 — `stance-good` 79프레임/2600ms, `frontkick-good` 61프레임/2000ms, 둘 다 프레임 간격 33.3~33.4ms(30fps). **앞차기 한 번이 2.0초**라 PRD의 창 길이 2.0초는 앞차기 한 사이클을 정확히 담습니다.

---

### 12.5 시각 효과 — 무엇이 공짜이고 무엇이 라운드를 죽이나

**측정 방법이 결론을 뒤집는 항목입니다.** 처음에 프레임마다 `getImageData` 로 강제 플러시해 재었더니 `shadowBlur` 가 18.5ms/프레임으로 나왔는데, **실제 rAF 루프에서는 멀쩡했습니다.** 캔버스 명령은 큐에 쌓이고 래스터화는 GPU에서 비동기로 일어나므로, **`performance.now()` 로 그리기 호출만 감싸면 진짜 비용이 안 잡힙니다.** 아래는 전부 **보이는 캔버스(1440×1080, 표시 720×540)에서 2초간 실제 rAF 루프를 돌려** 얻은 값입니다.

| 장면 | 달성 fps | 프레임 시간 중앙값 | p95 |
|---|---|---|---|
| 스켈레톤 1벌(35선 + 33점) | **120.5** | 8.3ms | 8.5ms |
| **스켈레톤 2벌(교본 오버레이, alpha 0.45)** | **120.5** | **8.3ms** | 9.2ms |
| 스켈레톤 2벌 + **파티클 400개** | **120.5** | **8.3ms** | 8.5ms |
| `shadowBlur = 18` 을 전부에 | 120.5 | 8.3ms | 8.9ms |
| **`ctx.filter = "blur(6px)"` 를 경로마다** | **2.8** | **433.3ms** | 441.7ms |
| `ctx.filter` 를 오프스크린 합성본에 **한 번만** | 97.5 | 8.4ms | 16.7ms |

**결론 한 줄: 교본 오버레이도, 파티클 400개도, 글로우도 공짜다. 라운드를 죽이는 것은 `ctx.filter` 하나다.**

`ctx.filter` 는 경로마다 별도 블러 패스를 돌리므로 35개 선이면 35번 블러합니다 — 433ms/프레임. **12.0(ㄴ)의 H3(120ms)를 프레임마다 넘깁니다.** 즉 "예쁘게 하려고 블러를 넣었더니 점수가 안 나온다"가 실제로 일어납니다. 꼭 블러가 필요하면 **오프스크린 캔버스에 다 그린 뒤 `drawImage` 한 장에만** 거세요(97.5fps, 그래도 p95 16.7ms라 공짜는 아닙니다).

외부 라이브러리 없이 만들 수 있는 것들(전부 실측으로 예산 안):

- **플래시** — 프레임 끝에 `fillStyle = "rgba(255,255,255,a)"` 로 전면 한 장. a 를 0.35에서 0으로 6프레임에 걸쳐 감쇠. 비용 0.
- **잔상** — 지우기를 `clearRect` 대신 `fillStyle = "rgba(13,17,23,0.18)"` 반투명 덮기로. 비용 0. **다만 `drawPose` 는 매 프레임 배경을 불투명하게 칠하므로**(`fillRect` with `theme.background`) 잔상을 쓰려면 배경 칠을 옵션으로 빼야 합니다.
- **파티클** — 400개까지 프레임 시간에 변화 없음. 회전·크기 없이 `arc` + `globalAlpha` 면 충분합니다.
- **글로우** — `shadowBlur` + `shadowColor` 를 **관절 몇 개에만**. 실측 120.8fps. 미리 만든 방사형 그러데이션 스프라이트를 `drawImage` 하는 방법도 있지만 33개를 찍으면 오히려 느렸습니다(강제 플러시 기준 6.3ms) — **`shadowBlur` 쪽이 낫습니다.**
- **링 펄스**(관절에서 퍼지는 원) — 비용 사실상 0.

`prefers-reduced-motion` 을 존중하세요. 플래시와 파티클은 그때 끕니다 — 접근성이자, 심사위원 노트북이 무엇이든 화면이 안 흔들린다는 보험입니다.

---

### 12.6 정적 내보내기와 번들

#### (ㄱ) 전부 정적 내보내기에서 됩니다

세 기능이 쓰는 API는 `canvas 2d` · `toBlob` · `Blob`/`URL` · `<a download>` · `requestAnimationFrame` · `Worker`(선택) · `OffscreenCanvas`(선택) — **전부 클라이언트 전용**이라 서버가 필요 없습니다. 조건은 4.4절 그대로입니다: **모듈 최상단에서 브라우저 API를 만지지 말 것.** 훅 안이나 이벤트 핸들러 안에서만 건드리면 프리렌더가 깨지지 않습니다. `transfer.ts` 가 이미 그 규율을 지키고 있으니 카드 렌더러도 같은 모양으로 두면 됩니다.

워커를 쓴다면 **별도 `.js` 파일을 두지 말고 소스 문자열 → `Blob` → `createObjectURL` 로 띄우세요.** `new Worker(new URL("./x.ts", import.meta.url))` 는 번들러 설정과 `basePath`(GitHub Pages `/poomsae-judge`)에 함께 걸립니다. 정적 자산을 참조해야 한다면 반드시 `assetUrl()`(`src/pose/samples.ts`)을 지나야 basePath 가 붙습니다.

카드에 로고·아이콘을 넣더라도 **외부 이미지를 그리면 캔버스가 오염(tainted)되어 `toBlob` 이 `SecurityError` 를 던집니다.** 코드로 그리라는 규칙이 여기서 기능적 이유를 하나 더 얻습니다.

#### (ㄴ) 번들 — 코드는 싸고, 라이브러리는 비싸다

현재(`main` 기준 실측): `/` 라우트 **28.6 kB**, **First Load JS 131 kB**, 공유 청크 103 kB. 상한 200 kB → 여유 **69 kB**.

저장소 사본에 **진짜 소스 581줄**(그리기 모듈 179줄 + React 스테이지 154줄 + 판정 패널 248줄, 채움 문자열이 아니라 기존 모듈을 복제해 압축률을 비슷하게 맞춤)을 더해 빌드했습니다.

| 빌드 | 라우트 크기 | First Load JS | 증가 |
|---|---|---|---|
| 현재 (`main`) | 28.6 kB | **131 kB** | — |
| **+ 진짜 소스 581줄** | 29.9 kB | **133 kB** | **+2 kB** |
| + `canvas-confetti` | 34 kB | **137 kB** | +4.1 kB |
| + `canvas-confetti` + `html2canvas` | 78.9 kB | **182 kB** | **+49 kB** |

**소스 1줄당 First Load JS 약 3.4바이트**(581줄 → 2 kB). 세 기능을 넉넉히 2,000~2,500줄로 잡아도 **+7~9 kB, 합계 138~140 kB** 로 상한의 70% 입니다. **코드 양은 전혀 문제가 아닙니다.**

문제는 라이브러리입니다. `html2canvas` 하나가 **45 kB** — 12.1에서 실측한 대로 캔버스 카드는 200줄 남짓이면 직접 그려지고, 그쪽이 **글꼴·색·한글 줄바꿈을 전부 통제할 수 있어 결과도 낫습니다**(`html2canvas` 는 CSS 를 흉내 내는 것이라 재현이 어긋납니다). `canvas-confetti` 4.1 kB 도 12.5 실측대로 30줄이면 됩니다.

→ **세 기능 모두 새 의존성 0으로 간다.** 이건 번들 예산 문제이자, 과제의 "외부 에셋 내려받지 말 것"과 같은 방향입니다.

---

### 12.7 이 실사에서 **확인하지 못한 것**

- **배경 탭 throttling 실측.** 이 브라우저 패널에서는 탭을 뒤로 보내도 `visibilityState` 가 `visible` 로 남아(rAF 115Hz 유지, `visibilitychange` 미발화) 재현하지 못했습니다. 12.4(ㄱ)은 공식 문서 근거이고 로컬 실측이 아닙니다. 12.4(ㄴ)의 "1.49초가 사라진다"는 **메인 스레드를 막아 만든 등가 상황**의 실측입니다.
- **iOS 사파리 전부.** `a[download]` 가 저장 대신 새 창으로 열리는지, `navigator.share({files})` 가 실제로 뜨는지, 큰 PNG 에서 `toBlob` 이 `null` 을 주는지 — 기기가 없어 하나도 확인하지 못했습니다. 12.1(ㅁ)의 대비책(미리보기 `<img>` + "길게 눌러 저장")은 **가정에 따른 방어**입니다.
- **한글 두부가 실제로 나는 환경.** 이 맥에서는 어떤 스택을 줘도 한글이 정상으로 그려져, 12.2(ㄴ)의 검사 함수가 `false` 를 내는 경우를 못 봤습니다. 폴백 경로는 **인위적으로 `false` 를 주입해 테스트**해야 합니다.
- **윈도·안드로이드에서의 카드 레이아웃.** 글꼴이 다르면 폭이 달라집니다. 12.2(ㄹ)의 `measureText` 규율을 지키면 겹치지 않는다는 것은 **논리적 보장이지 실측이 아닙니다.**
- **웹캠 실검출에서의 좌표 성질.** 12.3의 아핀 복원·엉덩이 원점·몸통 길이 안정성은 전부 **합성 샘플 7종**에서 잰 값입니다. 실검출 랜드마크는 잡음이 있으므로, 특히 몸통 길이가 프레임마다 흔들리면 교본 배율이 떨립니다 — **중앙값 몇 프레임으로 평활**할 준비를 해 두세요.
- **판정 창 21개 쓸기의 실데이터 동작.** 1.19ms 는 합성 샘플 기준입니다. 실검출에서는 무효 프레임이 섞여 창마다 보류가 갈릴 수 있고, "모든 창이 보류면 라운드도 보류"가 얼마나 자주 발생하는지는 실기기에서만 알 수 있습니다.

---

### 12.8 결론표

| # | 항목 | 결론 | 근거 |
|---|---|---|---|
| 1 | 카드 내보내기 형식 | **PNG, 1080×1350, 고정 배율 2x** | 2160×2700 = 921 kB / 25.5ms. 3x는 2배 무겁고 차이 없음 |
| 2 | 내보내기 API | **`toBlob`** (`toDataURL` 아님), `null` 분기 필수 | 같은 속도에 문자열 33% 더 큼 |
| 3 | 배율 기준 | `devicePixelRatio` **금지**, 상수 2 | 기기마다 파일이 달라짐 |
| 4 | 첫 인코딩 | **워밍업 필수** (1×1 `toBlob` 1회) | 콜드 1078ms → H3(120ms) 초과 |
| 5 | 기록 중 내보내기 | **하지 말 것.** 꼭 하면 **워커** | 워커 88.4ms 오프스레드, 메인 0 |
| 6 | `revokeObjectURL` | **다음 태스크로 미룰 것** | 취소 즉시 URL 사망(실측) |
| 7 | 공유 | `share` 는 **보조**, 내려받기가 기본 | 이 환경 `canShare` = false |
| 8 | 글꼴 | 시스템 스택, 웹폰트 0 | 내려받기 0, FOUT 0 |
| 9 | 글꼴 탐지 | `document.fonts.check` **금지** → **두부 픽셀 검사** | 존재하지 않는 이름에도 true |
| 10 | 한글 폴백 | 규칙 ID + 숫자/기호 + 아이콘 | 점수·측정값·경계값은 원래 라틴 |
| 11 | 글자 배치 | `measureText` 체이닝, 상수 x **금지**, 줄간격 1.5em | 시안에서 실제로 겹침, 1.19em이 최소 |
| 12 | 교본 좌표 변환 | `projectFrames` 재호출 **금지** → **프레임에서 아핀 복원** | 재투영 오차 1.4e-11 px |
| 13 | 교본 배율 기준 | **화면평면 몸통 길이** (어깨폭 S 아님) | 측면 어깨폭 0.0002 → 340배 폭발 |
| 14 | 각도 차이 계산 | **`world` 로만** | image 로 재면 최대 15.2° 오차 |
| 15 | 거울 | 교본은 같은 `save/restore` 안에서, **라벨은 밖에서** | 안에서 그리면 한글이 좌우 반전 |
| 16 | 게임 시계 | `performance.now()` / rAF `timestamp`. 프레임 세기 **금지** | 1.5초 정지에서 1.49초 증발 |
| 17 | 탭 이탈 | `visibilitychange` 로 **라운드 무효 후 재시작** | 어차피 H3 보류가 됨 |
| 18 | 판정 창 21개 쓸기 | **그대로 가도 됨** | 21개 1.19ms, 한 프레임 안 |
| 19 | 채택 창 표시 | 게임의 2초 창이 아니라 **`judgedFrom/judgedTo`** | 되감기와 채점 구간이 어긋남 |
| 20 | `ctx.filter` 블러 | **루프에서 금지** | 433ms/프레임 = 2.8fps = H3 즉사 |
| 21 | 그 외 효과 | 스켈레톤 2벌·파티클 400·`shadowBlur` 전부 **공짜** | 120.5fps 유지 |
| 22 | 새 의존성 | **0** | `html2canvas` 45 kB, `canvas-confetti` 4.1 kB |
| 23 | 번들 여유 | 2,500줄 더해도 **~140 kB** (상한 200) | 581줄 = +2 kB |
| 24 | H3 예산 | 맞추기 단계에서 **어떤 작업도 120ms 넘기지 말 것** | 30fps 연속 3프레임 결손 = 보류 |

### 12.9 구현 규칙 (요약)

1. **맞추기 단계의 메인 스레드 예산은 120ms다.** 성능이 아니라 정확성 문제다 — 넘기면 점수가 사라진다(H3).
2. **좌표계는 둘, 용도도 둘.** `world` = 재는 것, `image` = 찍는 것. 오버레이의 각도 차이는 `world` 로만 계산한다.
3. **교본은 내 프레임에서 복원한 아핀 변환을 탄다.** `projectFrames` 를 두 번 부르지 않는다.
4. **화면 배율 기준은 몸통 길이.** 판정의 S는 그대로 둔다. 화면에 그 사실을 적는다.
5. **시계는 하나.** 프레임을 세지 않는다. `usePlayback` 이 `frame.t` 하나로 사는 것과 같은 규율.
6. **카드는 결정적으로.** 고정 배율, 고정 크기, DPR 무관. 같은 판정이면 같은 이미지.
7. **글자 좌표는 언제나 `measureText` 에서 나온다.** 상수 x는 다른 기기에서 겹친다.
8. **`ctx.filter` 는 루프에 넣지 않는다.** 나머지 효과는 마음껏 써도 된다.
9. **새 의존성 0.** 카드도 파티클도 200줄이면 된다.
10. **규칙 상수·산식은 이 작업에서 한 글자도 바뀌지 않는다.** 여기서 새로 생긴 숫자(6°/15° 표시 문턱, 창 2.0초/0.2초, 카드 1080×1350/2x)는 전부 **표현 층**이고, `src/judge/constants.ts` 에 들어가지 않는다.
