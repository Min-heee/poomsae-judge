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
