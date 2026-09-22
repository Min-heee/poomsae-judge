/**
 * 2D 캔버스에 스켈레톤을 그린다.
 *
 * 입력은 정규화 이미지 좌표다. 각도 계산에는 절대 쓰지 않는다(축 스케일이 다르다).
 * 여기서는 그냥 캔버스 폭·높이를 곱해 점을 찍는 것뿐이므로 문제가 없다.
 */

import { LANDMARK_NAMES_KO, LM, POSE_EDGES } from "@/judge/landmarks";
import { WITHHOLD } from "@/judge/constants";
import type { Landmark } from "@/judge/types";

/** 몸통·다리 = 굵게, 얼굴·손 = 가늘게. 위계를 줘야 자세가 읽힌다. */
const CORE_EDGES = new Set(
  [
    [11, 12], [11, 23], [12, 24], [23, 24],
    [23, 25], [24, 26], [25, 27], [26, 28],
    [11, 13], [13, 15], [12, 14], [14, 16],
  ].map(([a, b]) => `${a}-${b}`),
);

export interface DrawTheme {
  background: string;
  floor: string;
  bone: string;
  boneCore: string;
  joint: string;
  jointCore: string;
  weak: string;
}

export const DARK_THEME: DrawTheme = {
  background: "#0d1117",
  floor: "#1c2430",
  bone: "#3d4a5c",
  boneCore: "#8ab4f8",
  joint: "#5b6b80",
  jointCore: "#cfe1ff",
  weak: "#ff7b72",
};

export interface DrawOptions {
  landmarks: Landmark[] | null;
  /** 웹캠 모드에서 뒤에 깔 영상 */
  video?: HTMLVideoElement | null;
  /** 거울 모드(웹캠 기본) */
  mirror?: boolean;
  theme?: DrawTheme;
  /** 바닥선을 그릴지 (샘플 모드에서 사람이 서 있다는 감각을 준다) */
  floor?: boolean;
  /** 지금 판정이 보고 있는 관절 — 더 크게 찍는다 */
  emphasis?: readonly number[];
}

/**
 * 캔버스 하나를 통째로 다시 그린다.
 * 부분 갱신을 하지 않는 이유: 프레임마다 전부 바뀌고, 33점·35선은 비용이 없다.
 */
export function drawPose(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opts: DrawOptions,
): void {
  const theme = opts.theme ?? DARK_THEME;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  if (opts.mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }

  if (opts.video && opts.video.readyState >= 2) {
    // 비율을 유지하며 꽉 채운다(cover).
    const vw = opts.video.videoWidth;
    const vh = opts.video.videoHeight;
    if (vw > 0 && vh > 0) {
      const scale = Math.max(width / vw, height / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      ctx.globalAlpha = 0.55;
      ctx.drawImage(opts.video, (width - dw) / 2, (height - dh) / 2, dw, dh);
      ctx.globalAlpha = 1;
    }
  } else if (opts.floor !== false) {
    drawFloor(ctx, width, height, theme);
  }

  const lms = opts.landmarks;
  if (!lms) {
    ctx.restore();
    return;
  }

  const px = (lm: Landmark) => [lm.x * width, lm.y * height] as const;
  const weak = (lm: Landmark) => lm.visibility < WITHHOLD.minVisibility;

  // 뼈대
  for (const [a, b] of POSE_EDGES) {
    const la = lms[a];
    const lb = lms[b];
    if (!la || !lb) continue;
    const core = CORE_EDGES.has(`${a}-${b}`);
    const [x1, y1] = px(la);
    const [x2, y2] = px(lb);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineCap = "round";
    if (weak(la) || weak(lb)) {
      ctx.strokeStyle = theme.weak;
      ctx.lineWidth = core ? 4 : 2;
      ctx.setLineDash([5, 5]);
    } else {
      ctx.strokeStyle = core ? theme.boneCore : theme.bone;
      ctx.lineWidth = core ? 5 : 2;
      ctx.setLineDash([]);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 관절
  const emphasis = new Set(opts.emphasis ?? DEFAULT_EMPHASIS);
  for (let i = 0; i < lms.length; i += 1) {
    const lm = lms[i];
    if (!lm) continue;
    const [x, y] = px(lm);
    const big = emphasis.has(i);
    ctx.beginPath();
    ctx.arc(x, y, big ? 6 : 3, 0, Math.PI * 2);
    ctx.fillStyle = weak(lm) ? theme.weak : big ? theme.jointCore : theme.joint;
    ctx.fill();
  }

  ctx.restore();
}

/** 규칙이 실제로 읽는 관절. 크게 찍어서 "무엇을 보고 있는지"를 드러낸다. */
export const DEFAULT_EMPHASIS: readonly number[] = [
  LM.leftShoulder,
  LM.rightShoulder,
  LM.leftHip,
  LM.rightHip,
  LM.leftKnee,
  LM.rightKnee,
  LM.leftAnkle,
  LM.rightAnkle,
];

function drawFloor(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  theme: DrawTheme,
): void {
  ctx.strokeStyle = theme.floor;
  ctx.lineWidth = 1;
  for (let i = 1; i <= 6; i += 1) {
    const y = height * (0.62 + i * 0.055);
    if (y > height) break;
    const inset = width * (0.5 - 0.5 / (1 + i * 0.35));
    ctx.beginPath();
    ctx.moveTo(inset, y);
    ctx.lineTo(width - inset, y);
    ctx.stroke();
  }
}

/** 안 보이는 필수 관절의 한국어 이름 — 캔버스 아래 문장에 쓴다. */
export function weakLandmarkNames(lms: Landmark[] | null): string[] {
  if (!lms) return [];
  return lms
    .map((lm, i) => ({ lm, i }))
    .filter(({ lm }) => lm.visibility < WITHHOLD.minVisibility)
    .map(({ i }) => LANDMARK_NAMES_KO[i] ?? `#${i}`);
}
