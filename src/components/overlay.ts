/**
 * 교본 오버레이 — 기준 자세를 내 스켈레톤 위에 **같은 자로** 얹고, 어긋난 관절을 칠한다.
 *
 * 이 파일은 그리기만 한다. 무엇이 얼마나 어긋났는지는 비교 코어(`@/follow`)가 정하고,
 * 여기서는 그 결과(`Comparison`)를 색과 선으로 옮길 뿐이다. 각도를 여기서 다시 재지 않는다 —
 * 두 곳에서 재면 화면의 빨강과 코어의 빨강이 언젠가 다른 관절을 가리킨다.
 *
 * 화면 규율 네 가지(docs/TECH-NOTES.md 12.3·12.9):
 *
 * 1. **각도는 `world` 로만 잰다.** 그 일은 비교 코어가 하고, 이 파일은 `image` 좌표로
 *    점만 찍는다. 정규화 이미지 좌표는 x가 종횡비만큼 눌려 있어 같은 무릎을 두 좌표계에서
 *    재면 최대 15.2° 차이가 난다 — 표시 문턱이 6°/15°이므로 오차 하나가 등급을 넘긴다.
 * 2. **`projectFrames` 를 다시 부르지 않는다.** 그 함수는 시퀀스 전체의 경계상자로 배율을
 *    정하므로 한 프레임짜리 교본을 따로 넣으면 팔다리 길이가 달라진다. 대신 내 프레임이
 *    실제로 쓴 world→image 변환을 **프레임 자신에게서 복원**한다(33점 재투영 오차 1.4e-11 px).
 * 3. **화면 배율 기준은 어깨 폭 S가 아니라 몸통 길이다.** S는 3차원 거리인데 오버레이는
 *    화면 평면에 그린다. 측면 촬영에서는 두 어깨가 깊이로 겹쳐 화면 위 어깨 폭이 0에
 *    수렴하고(실측 비 0.0029), 그 값으로 나누면 교본이 340배로 부풀어 캔버스 밖으로 난다.
 *    몸통(어깨중점→엉덩이중점)은 정면·측면 모두 화면 평면에 놓이고 둘의 차가 ±1.5%다.
 *    **판정과 비교가 쓰는 S는 그대로 둔다** — 여기서 바꾸는 것은 그리기 배율뿐이다.
 * 4. **거울 안에서 글자를 그리지 않는다.** `scale(-1,1)` 안에서 `fillText` 하면 한글이
 *    좌우로 뒤집힌다. 교본은 거울 안, 라벨은 거울 밖에서 x만 손으로 되접는다.
 *
 * ### 색 규약 — 뿌리는 두 줄
 *
 * **(ㄱ) 층이 다르면 색상 계열이 다르다.** 판정 층(감점·보류)은 빨강·노랑·보라를 쓰고,
 * 이 층(교본과 얼마나 다른가)은 **자홍만** 쓴다. 처음에는 어긋남에 `--bad`(#f78787)를
 * 그대로 썼는데, 그러면 10.0점 · 감점 0인 앞차기에 오버레이를 켠 순간 몸통이
 * **감점색**으로 덮였다 — 한 색이 "깎였다"와 "교본과 다르다"를 동시에 말하게 된다.
 * 두 말은 서로 무관하다. **교본과의 차이는 감점을 만들지 않는다.**
 *
 * **(ㄴ) 점선 = "읽지 못했다", 실선 = "읽었다".**
 *
 * | 무엇 | 표현 |
 * |---|---|
 * | 흐린 관절(visibility < 0.5) | **빨강 점선** — `src/pose/draw2d.ts` 의 기존 표현. **바꾸지 않는다.** |
 * | 교본 고스트 | `--brand-dim` 반투명 실선, 관절은 빈 원 |
 * | 어긋남(`off`) | **짙은 자홍 실선 + 굵은 링 + 숫자 라벨** |
 * | 주의(`warn`) | 옅은 자홍 실선 + 링 + 숫자 라벨 |
 * | 맞음(`ok`)·비교 안 함(`none`) | 평소 색 |
 *
 * 빨강 점선과 자홍 실선은 **한 관절에 동시에 칠해질 수 없다.** 흐린 관절은 지표를
 * 읽지 않으므로 비교 코어가 `unreadable` 로 두고, `unreadable` 은 여기서 아무 색도 받지
 * 않는다 — 표현이 다른 것에 기대지 않고 **구조가 보장하는 배타**다. 색상 하나에만
 * 기대지도 않는다: 어긋난 관절에는 링과 숫자 라벨이 함께 붙는다(색각 이상 대비).
 * 그래도 화면에는 범례(`OverlayLegend`)를 상시 둔다.
 */

import type { Comparison, MatchBand, MetricComparison } from "@/follow";
import { LM, POSE_EDGES } from "@/judge/landmarks";
import type { Landmark } from "@/judge/types";
import type { PoseFrame } from "@/pose";

/* ── 색 ──────────────────────────────────────────────────────────────── */

/**
 * globals.css 의 토큰과 같은 값. 캔버스는 CSS 변수를 못 읽으므로 여기 한 벌만 둔다.
 *
 * `off`·`warn` 은 **판정 층의 색이 아니다** — `--off`·`--off-soft` 이고, 감점의
 * `--bad`(#f78787)·`--warn`(#f2c15b)과 일부러 다른 계열이다(위 색 규약 (ㄱ)).
 */
export const OVERLAY_COLORS = {
  /** --brand-dim */
  ghost: "#4e6fae",
  /** --off-soft. 주의 — 옅은 자홍. */
  warn: "#ffb5e4",
  /** --off. 어긋남 — 짙은 자홍. 감점색(--bad)도, 흐림색(#ff7b72)도 아니다. */
  off: "#ff6ec7",
  /** draw2d 의 `theme.weak`. 범례에서 "점선 = 읽지 못함"을 보일 때만 쓴다. */
  weak: "#ff7b72",
  label: "#e9eff7",
  labelBack: "rgba(8, 12, 18, 0.82)",
} as const;

export function bandColor(band: MatchBand): string | null {
  if (band === "off") return OVERLAY_COLORS.off;
  if (band === "warn") return OVERLAY_COLORS.warn;
  return null;
}

/**
 * 차이 하나를 숫자 한 덩이로. `+12.0°` · `−0.41·S` · `읽지 못함`.
 *
 * 이것을 따로 내보내는 이유: 곁 표가 `metricText(m).split(" ").at(-1)` 로 문장에서
 * 숫자를 도로 뜯어내고 있었다. 그러면 **표시 문자열의 형식이 사실상 API** 가 되어,
 * 라벨에 단어 하나만 더해도 표에 엉뚱한 글자가 뜬다(타입도 테스트도 못 잡는다).
 * 두 표현이 같은 출처에서 나오게 한다.
 */
export function metricDeltaText(m: MetricComparison): string {
  if (m.diff === null) return "읽지 못함";
  const unit = m.unit === "deg" ? "°" : "·S";
  const sign = m.diff > 0 ? "+" : "−";
  const digits = m.unit === "deg" ? 1 : 2;
  return `${sign}${Math.abs(m.diff).toFixed(digits)}${unit}`;
}

/** 지표 한 줄을 사람이 읽는 문장으로. 부호를 남긴다 — 덜 굽은 것과 더 굽은 것은 고치는 법이 반대다. */
export function metricText(m: MetricComparison): string {
  return `${m.labelKo} ${metricDeltaText(m)}`;
}

/* ── 좌표 맞추기 ─────────────────────────────────────────────────────── */

/** 화면 평면에 놓이는 길이. 정면·측면 모두에서 살아남는 유일한 기준 길이다. */
function torsoLength(f: readonly Landmark[]): number {
  const sx = (f[LM.leftShoulder].x + f[LM.rightShoulder].x) / 2;
  const sy = (f[LM.leftShoulder].y + f[LM.rightShoulder].y) / 2;
  const hx = (f[LM.leftHip].x + f[LM.rightHip].x) / 2;
  const hy = (f[LM.leftHip].y + f[LM.rightHip].y) / 2;
  return Math.hypot(sx - hx, sy - hy);
}

function hipMidOf(f: readonly Landmark[]): { x: number; y: number } {
  return {
    x: (f[LM.leftHip].x + f[LM.rightHip].x) / 2,
    y: (f[LM.leftHip].y + f[LM.rightHip].y) / 2,
  };
}

/** 배율 추정에 쓰는 몸통·팔다리 12점. 얼굴은 잡음이 커서 뺀다. */
const FIT_POINTS: readonly number[] = [
  LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow,
  LM.leftWrist, LM.rightWrist, LM.leftHip, LM.rightHip,
  LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle,
];

export interface ImageMap {
  sx: number;
  sy: number;
  ox: number;
  oy: number;
}

/**
 * 이 프레임이 실제로 쓴 world→image 변환을 프레임 자신에게서 복원한다.
 *
 * 두 점으로 나누는 방식(TECH-NOTES 12.3 ㄴ)은 **측면에서 깨진다** — 두 어깨의 world x가
 * 거의 같아 분모가 0에 수렴한다. 그래서 y축만 최소제곱으로 기울기를 구하고(사람은 늘
 * 세로로 길어 y의 분산은 충분하다), x축 배율은 `projectFrames` 가 보장하는 관계
 * `sx = sy / aspect` 로 얻는다. 합성 샘플에서 이 관계는 소수 6자리까지 실측 확인됐다.
 */
export function imageMapOf(frame: PoseFrame, aspect: number): ImageMap | null {
  const pts = FIT_POINTS.filter((i) => frame.world[i] && frame.image[i]);
  if (pts.length < 4) return null;

  let mwy = 0;
  let miy = 0;
  for (const i of pts) {
    mwy += frame.world[i].y;
    miy += frame.image[i].y;
  }
  mwy /= pts.length;
  miy /= pts.length;

  let num = 0;
  let den = 0;
  for (const i of pts) {
    const dw = frame.world[i].y - mwy;
    num += dw * (frame.image[i].y - miy);
    den += dw * dw;
  }
  if (!(Math.abs(den) > 1e-12)) return null;

  const sy = num / den;
  if (!Number.isFinite(sy) || Math.abs(sy) < 1e-9) return null;
  const sx = sy / (aspect > 0 ? aspect : 1);

  let mwx = 0;
  let mix = 0;
  for (const i of pts) {
    mwx += frame.world[i].x;
    mix += frame.image[i].x;
  }
  mwx /= pts.length;
  mix /= pts.length;

  return { sx, sy, ox: mix - sx * mwx, oy: miy - sy * mwy };
}

/**
 * 교본을 내 프레임과 같은 자 위에 놓는다. 결과는 **그리기 전용 image 좌표**다.
 *
 * 정렬은 셋뿐이다. (1) 몸통 길이로 배율을 맞춘다. (2) 엉덩이 중점을 겹친다
 * (world 원점이 이미 엉덩이 중점이라 평행이동은 사실상 0이다 — 실측 ±0.0015 m).
 * (3) 내 프레임에서 복원한 변환을 그대로 태운다. **회전 정렬은 하지 않는다** —
 * 맞추면 규칙이 전제하는 카메라 각도(H6)가 흐려진다.
 *
 * 플레이어가 반대쪽 팔·다리로 했으면(`Comparison.mirrored`) 교본을
 * `mirrorFrame` 으로 뒤집어 넘긴다. 그 판단은 비교 코어가 하고 여기서는 받은 대로 그린다.
 */
export function fitReferenceToFrame(
  frame: PoseFrame,
  refWorld: readonly Landmark[] | null,
  aspect: number,
): Landmark[] | null {
  if (!refWorld || refWorld.length < 33) return null;
  const map = imageMapOf(frame, aspect);
  if (!map) return null;

  const tRef = torsoLength(refWorld);
  const tMine = torsoLength(frame.world);
  if (!(tRef > 1e-9) || !(tMine > 1e-9)) return null;
  const k = tMine / tRef;

  const hipRef = hipMidOf(refWorld);
  const hipMine = hipMidOf(frame.world);

  return refWorld.map((lm) => {
    const wx = hipMine.x + (lm.x - hipRef.x) * k;
    const wy = hipMine.y + (lm.y - hipRef.y) * k;
    return {
      x: map.ox + map.sx * wx,
      y: map.oy + map.sy * wy,
      z: 0,
      // 교본은 만들어진 좌표라 언제나 '읽은' 것이다. 흐림 점선이 붙을 자리가 없다.
      visibility: 1,
    };
  });
}

/**
 * 겹칠 사람이 없을 때(제시 단계·카메라가 아직 프레임을 못 냈을 때) 교본만 화면 가운데에 놓는다.
 *
 * **내 자세와 겹치는 순간에는 이 함수를 쓰지 않는다**(그때는 반드시 `fitReferenceToFrame`).
 * 두 스켈레톤이 서로 다른 자로 그려지면 어긋남이 자세가 아니라 배율에서 나온다.
 */
export function fitReferenceStandalone(
  refWorld: readonly Landmark[] | null,
  aspect: number,
  fill = 0.72,
): Landmark[] | null {
  if (!refWorld || refWorld.length < 33) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const i of FIT_POINTS) {
    const lm = refWorld[i];
    if (!lm) continue;
    if (lm.x < minX) minX = lm.x;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.y > maxY) maxY = lm.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  const a = aspect > 0 ? aspect : 4 / 3;
  const h = Math.max(maxY - minY, 1e-6);
  const w = Math.max(maxX - minX, 1e-6);
  const viewH = Math.max(h / fill, w / (fill * a));
  const viewW = viewH * a;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  return refWorld.map((lm) => ({
    x: 0.5 + (lm.x - cx) / viewW,
    y: 0.5 + (lm.y - cy) / viewH,
    z: 0,
    visibility: 1,
  }));
}

/* ── 그리기 ──────────────────────────────────────────────────────────── */

/** 얼굴(0~10)에 닿는 간선은 그리지 않는다. 머리는 원 하나로 대신한다. */
const BODY_EDGES = POSE_EDGES.filter(([a, b]) => a > 10 && b > 10);

const BAND_RANK: Record<MatchBand, number> = {
  none: 0,
  unreadable: 0,
  ok: 1,
  warn: 2,
  off: 3,
};

export interface OverlayDrawOptions {
  mirror?: boolean;
  /** 교본 — image 좌표(`fitReferenceToFrame` 의 결과) */
  ghost: readonly Landmark[] | null;
  /** 내 자세 — image 좌표. 어긋난 뼈를 덧칠할 때만 쓴다. */
  player: readonly Landmark[] | null;
  /** 비교 코어의 결과. 관절 색과 라벨이 전부 여기서 나온다. */
  comparison: Comparison | null;
  /** 숫자 라벨을 붙일 최대 개수. 화면이 숫자로 뒤덮이지 않게. */
  maxLabels?: number;
  alpha?: number;
}

/**
 * 교본과 어긋남을 캔버스에 얹는다. **`drawPose` 를 부른 직후에 같은 캔버스에 부른다.**
 *
 * `ctx.filter` 는 쓰지 않는다 — 경로마다 블러 패스를 돌려 433ms/프레임(2.8fps)이 되고,
 * 그러면 H3(인접 프레임 간격 120ms)에 걸려 **점수가 사라진다.** 나머지 효과(선 2벌·글로우·
 * 파티클)는 실측상 프레임 예산에 영향이 없다(120.5fps 유지).
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opts: OverlayDrawOptions,
): void {
  const alpha = opts.alpha ?? 1;
  if (alpha <= 0.01) return;

  const px = (lm: Landmark) => [lm.x * width, lm.y * height] as const;

  ctx.save();
  if (opts.mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.lineCap = "round";
  ctx.setLineDash([]);

  // 1) 교본 고스트 — 반투명 실선, 관절은 빈 원
  const ghost = opts.ghost;
  if (ghost) {
    ctx.globalAlpha = 0.5 * alpha;
    ctx.strokeStyle = OVERLAY_COLORS.ghost;
    ctx.lineWidth = 7;
    for (const [a, b] of BODY_EDGES) {
      const la = ghost[a];
      const lb = ghost[b];
      if (!la || !lb) continue;
      ctx.beginPath();
      ctx.moveTo(...px(la));
      ctx.lineTo(...px(lb));
      ctx.stroke();
    }
    drawHead(ctx, ghost, width, height, 4);
    ctx.lineWidth = 3;
    for (const i of FIT_POINTS) {
      const lm = ghost[i];
      if (!lm) continue;
      const [x, y] = px(lm);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // 2) 어긋난 관절 — 내 뼈를 그 색으로 덧칠하고 링을 씌운다
  const player = opts.player;
  const bands = opts.comparison?.jointBands ?? null;
  if (player && bands) {
    ctx.globalAlpha = 0.95 * alpha;

    for (const [a, b] of BODY_EDGES) {
      const la = player[a];
      const lb = player[b];
      if (!la || !lb) continue;
      const band = BAND_RANK[bands[a]] >= BAND_RANK[bands[b]] ? bands[a] : bands[b];
      const color = bandColor(band);
      if (!color) continue;
      ctx.strokeStyle = color;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(...px(la));
      ctx.lineTo(...px(lb));
      ctx.stroke();
    }

    for (let i = 0; i < bands.length; i += 1) {
      const color = bandColor(bands[i]);
      const lm = player[i];
      if (!color || !lm) continue;
      const [x, y] = px(lm);
      ctx.strokeStyle = color;
      ctx.lineWidth = bands[i] === "off" ? 4 : 3;
      ctx.beginPath();
      ctx.arc(x, y, bands[i] === "off" ? 15 : 12, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();

  // 3) 라벨 — **거울 밖에서** 그린다. 안에서 그리면 한글이 좌우로 뒤집힌다.
  const off = opts.comparison?.off ?? [];
  if (!player || off.length === 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = "600 15px system-ui, -apple-system, 'Apple SD Gothic Neo', sans-serif";
  ctx.textBaseline = "middle";
  const used: number[] = [];
  for (const m of off.slice(0, opts.maxLabels ?? 4)) {
    const joint = m.joints.find((j) => player[j] !== undefined);
    if (joint === undefined) continue;
    const [rawX, rawY] = px(player[joint]);
    const x = opts.mirror ? width - rawX : rawX;
    // 라벨이 서로 겹치면 아래로 한 줄씩 민다.
    let y = rawY;
    while (used.some((u) => Math.abs(u - y) < 26)) y += 26;
    used.push(y);

    const text = metricText(m);
    // x를 상수로 박지 않는다 — 기기마다 글자 폭이 달라 겹친다(TECH-NOTES 12.2 ㄹ).
    const w = ctx.measureText(text).width;
    const bx = Math.min(Math.max(x + 18, 10), width - w - 12);
    // 위아래 끝은 HUD(라운드 표시·남은 시간 막대)가 쓰는 자리다. 그 위에 겹치지 않게 접어 둔다.
    const by = Math.min(Math.max(y, 48), height - 66);
    ctx.fillStyle = OVERLAY_COLORS.labelBack;
    ctx.beginPath();
    ctx.roundRect(bx - 6, by - 12, w + 12, 24, 6);
    ctx.fill();
    ctx.fillStyle = bandColor(m.band) ?? OVERLAY_COLORS.label;
    ctx.fillText(text, bx, by);
  }
  ctx.restore();
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  lms: readonly Landmark[],
  width: number,
  height: number,
  lineWidth: number,
): void {
  const sl = lms[LM.leftShoulder];
  const sr = lms[LM.rightShoulder];
  const hl = lms[LM.leftHip];
  const hr = lms[LM.rightHip];
  if (!sl || !sr || !hl || !hr) return;
  const cx = ((sl.x + sr.x) / 2) * width;
  const sy = ((sl.y + sr.y) / 2) * height;
  const hy = ((hl.y + hr.y) / 2) * height;
  const r = Math.max(Math.abs(hy - sy) * 0.32, 6);
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.arc(cx, sy - r * 1.25, r, 0, Math.PI * 2);
  ctx.stroke();
}
