/**
 * 바깥에서 들어온 JSON을 PoseSequence 로 정규화한다.
 *
 * 로더는 흔한 키 이름 몇 가지를 모두 받아 준다(`world`/`worldLandmarks`/`lm`,
 * `landmarks`/`image`). 하지만 모르는 모양이면 조용히 넘기지 않고 던진다 —
 * 틀린 좌표로 그럴듯한 점수를 내는 것이 제일 나쁘다.
 *
 * **`visibility` 는 없으면 거부한다.** 한때 이 로더는 빠진 신뢰도를 1.0(완벽히
 * 보임)으로 채웠다. 그 기본값 하나 때문에 H1(신뢰도 게이트)과 H2(무효 비율)가
 * 구조적으로 발동할 수 없었다 — 가려진 샘플에서 네 번째 칸만 지우면 판정 보류가
 * 10.0 만점으로 바뀌었다. 모르는 신뢰도를 "잘 보인다"로 읽는 것은 PRD 원칙 3
 * ("애매한 입력을 닫는다")과 정반대다. 모르면 받지 않는다.
 *
 * 좌표계는 src/pose/types.ts 의 약속을 따른다: world 는 y가 아래로 증가한다.
 */

import { LANDMARK_COUNT, LM } from "@/judge/landmarks";
import type { CameraView, Landmark, MotionKind } from "@/judge/types";
import type { PoseFrame, PoseSequence, SequenceOrigin } from "./types";

export class SequenceFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SequenceFormatError";
  }
}

type LooseLandmark = { x?: unknown; y?: unknown; z?: unknown; visibility?: unknown } | number[];

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** 파일이 `fields` 로 선언할 수 있는 유일한 칸 순서. codec.ts 가 쓰는 것과 같다. */
export const REQUIRED_FIELDS = ["x", "y", "z", "visibility"] as const;

function finite(v: unknown, where: string, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new SequenceFormatError(`${where}: ${what} 가 숫자가 아닙니다 (${JSON.stringify(v)}).`);
  }
  return v;
}

function toLandmark(raw: LooseLandmark, where: string, index: number): Landmark {
  const at = `${where} 의 ${index}번 관절`;
  if (Array.isArray(raw)) {
    if (raw.length < 4) {
      throw new SequenceFormatError(
        `${at}: 칸이 ${raw.length}개입니다. [x, y, z, visibility] 네 칸이 필요합니다. ` +
          `신뢰도가 없는 좌표는 받지 않습니다 — 모르는 값을 '잘 보임'으로 채우면 판정 보류가 만점이 됩니다.`,
      );
    }
    return {
      x: finite(raw[0], at, "x"),
      y: finite(raw[1], at, "y"),
      z: finite(raw[2], at, "z"),
      visibility: finite(raw[3], at, "visibility"),
    };
  }
  if (raw.visibility === undefined) {
    throw new SequenceFormatError(
      `${at}: visibility 가 없습니다. 신뢰도가 없는 좌표는 받지 않습니다.`,
    );
  }
  return {
    x: finite(raw.x, at, "x"),
    y: finite(raw.y, at, "y"),
    z: finite(raw.z, at, "z"),
    visibility: finite(raw.visibility, at, "visibility"),
  };
}

function toLandmarkList(raw: unknown, where: string): Landmark[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length !== LANDMARK_COUNT) {
    throw new SequenceFormatError(
      `${where}: 랜드마크가 ${raw.length}개입니다. ${LANDMARK_COUNT}개여야 합니다.`,
    );
  }
  return raw.map((lm, i) => toLandmark(lm as LooseLandmark, where, i));
}

/**
 * 파일이 스스로 선언한 칸 순서를 검사한다.
 *
 * 샘플 파일 헤더에는 `"fields": ["x","y","z","visibility"]` 가 있는데, 한때
 * 아무도 이 키를 읽지 않고 인덱스만 하드코딩했다. 선언된 계약을 검사하지 않으면
 * 순서가 다른 파일이 조용히 엉뚱한 값으로 채점된다.
 */
function checkFields(raw: unknown): void {
  if (raw === undefined) return;
  const ok =
    Array.isArray(raw) &&
    raw.length === REQUIRED_FIELDS.length &&
    REQUIRED_FIELDS.every((f, i) => raw[i] === f);
  if (!ok) {
    throw new SequenceFormatError(
      `fields 가 [${REQUIRED_FIELDS.map((f) => `"${f}"`).join(", ")}] 가 아닙니다: ${JSON.stringify(raw)}.`,
    );
  }
}

function hipMidOf(list: Landmark[]) {
  const a = list[LM.leftHip];
  const b = list[LM.rightHip];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

/**
 * 정규화 이미지 좌표 → 판정 좌표 근사.
 *
 * x는 이미지 너비로, y는 높이로 나뉜 값이라 그대로 쓰면 축 스케일이 다르다.
 * x·z 에 종횡비를 곱해 세 축을 같은 단위(화면 높이)로 맞추고, 엉덩이 중점을
 * 원점으로 옮긴다. y 부호는 손대지 않는다 — 이미지 y도 판정 좌표 y도 아래로
 * 증가하기 때문이다. 단위는 미터가 아니지만 규칙이 전부 S로 나눈 비율과
 * 각도라 등급에는 영향이 없다(docs/TECH-NOTES.md 3.4 두 번째 선택지).
 */
function worldFromImage(image: Landmark[], aspect: number): Landmark[] {
  const scaled = image.map((lm) => ({
    x: lm.x * aspect,
    y: lm.y,
    z: lm.z * aspect,
    visibility: lm.visibility,
  }));
  const hip = hipMidOf(scaled);
  return scaled.map((lm) => ({
    x: lm.x - hip.x,
    y: lm.y - hip.y,
    z: lm.z - hip.z,
    visibility: lm.visibility,
  }));
}

/**
 * 판정 좌표 → 정규화 이미지 좌표(정사영). **그리기 전용**이다.
 *
 * 카메라 상수를 박지 않고 시퀀스 전체의 경계상자를 재어 맞춘다. 좌표가 미터든
 * 화면 높이 단위든, 사람이 크든 작든 화면 안에 들어오고 잘리지 않는다.
 * 한 프레임씩 맞추면 사람이 화면에 붙박여 움직임이 사라지므로 **시퀀스 단위**로 한 번만 잰다.
 */
export function projectFrames(worldFrames: Landmark[][], aspect: number): Landmark[][] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const frame of worldFrames) {
    for (const lm of frame) {
      if (lm.x < minX) minX = lm.x;
      if (lm.x > maxX) maxX = lm.x;
      if (lm.y < minY) minY = lm.y;
      if (lm.y > maxY) maxY = lm.y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return worldFrames.map((f) => f.map((lm) => ({ ...lm, x: 0.5, y: 0.5 })));
  }

  const FILL = 0.84; // 양옆·위아래 8%씩 여백
  const height = Math.max(maxY - minY, 1e-6);
  const width = Math.max(maxX - minX, 1e-6);
  const viewHeight = Math.max(height / FILL, width / (FILL * aspect));
  const viewWidth = viewHeight * aspect;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return worldFrames.map((frame) =>
    frame.map((lm) => ({
      x: 0.5 + (lm.x - centerX) / viewWidth,
      y: 0.5 + (lm.y - centerY) / viewHeight,
      z: lm.z / viewWidth,
      visibility: lm.visibility,
    })),
  );
}

interface LooseFrame {
  t?: unknown;
  timeMs?: unknown;
  time?: unknown;
  /** MediaPipe 이름: 정규화 이미지 좌표 */
  landmarks?: unknown;
  /** MediaPipe 이름: 미터 좌표 */
  worldLandmarks?: unknown;
  /** 샘플 생성기가 쓰는 짧은 이름 — 미터 좌표다 */
  lm?: unknown;
  image?: unknown;
  world?: unknown;
}

interface LooseSequence {
  id?: unknown;
  label?: unknown;
  title?: unknown;
  name?: unknown;
  motion?: unknown;
  view?: unknown;
  note?: unknown;
  intent?: unknown;
  description?: unknown;
  origin?: unknown;
  fps?: unknown;
  aspect?: unknown;
  /** 파일이 선언하는 칸 순서. 있으면 검사한다. */
  fields?: unknown;
  frames?: unknown;
}

function toMotion(raw: unknown, fallback: MotionKind): MotionKind {
  if (raw === "stance" || raw === "frontKick") return raw;
  if (typeof raw === "string") {
    const s = raw.toLowerCase();
    if (s.includes("stance") || s.includes("주춤")) return "stance";
    if (s.includes("kick") || s.includes("차기")) return "frontKick";
  }
  return fallback;
}

function toView(raw: unknown, motion: MotionKind): CameraView {
  if (raw === "frontal" || raw === "sagittal") return raw;
  return motion === "stance" ? "frontal" : "sagittal";
}

export interface NormalizeOptions {
  id: string;
  origin: SequenceOrigin;
  motionHint?: MotionKind;
  labelHint?: string;
  /** 목록(manifest)이 알고 있는 한 줄 설명 */
  noteHint?: string;
}

export function normalizeSequence(raw: unknown, opts: NormalizeOptions): PoseSequence {
  const src: LooseSequence = Array.isArray(raw) ? { frames: raw } : ((raw ?? {}) as LooseSequence);
  const rawFrames = src.frames;
  if (!Array.isArray(rawFrames) || rawFrames.length === 0) {
    throw new SequenceFormatError("frames 배열이 없거나 비어 있습니다.");
  }

  checkFields(src.fields);

  // 원본 영상의 가로÷세로. 그리기에만 쓰고 판정에는 들어가지 않는다 —
  // 판정은 world 좌표만 보기 때문이다(src/pose/types.ts 머리말).
  const aspect = num(src.aspect, 4 / 3);
  const fps = num(src.fps, 30);
  const motion = toMotion(src.motion, opts.motionHint ?? "stance");
  const view = toView(src.view, motion);

  // world(계산용)와 image(그리기용)를 섞지 않는다. 한쪽만 있으면 나머지를 만든다.
  const parsed = rawFrames.map((rf, i) => {
    const f = rf as LooseFrame;
    const t = num(f.t, num(f.timeMs, num(f.time, (i / Math.max(fps, 1)) * 1000)));
    const world = toLandmarkList(f.world ?? f.worldLandmarks ?? f.lm, `프레임 ${i}`);
    const image = toLandmarkList(f.image ?? f.landmarks, `프레임 ${i}`);
    if (!world && !image) {
      throw new SequenceFormatError(
        `프레임 ${i}: 좌표 배열이 없습니다 (world / worldLandmarks / lm / landmarks 중 하나가 필요).`,
      );
    }
    return { t, world, image };
  });

  const worlds = parsed.map((f) => f.world ?? worldFromImage(f.image as Landmark[], aspect));
  const needsProjection = parsed.some((f) => !f.image);
  const projected = needsProjection ? projectFrames(worlds, aspect) : null;

  const frames: PoseFrame[] = parsed.map((f, i) => ({
    t: f.t,
    world: worlds[i],
    image: f.image ?? (projected as Landmark[][])[i],
  }));

  // 시간이 뒤죽박죽이면 판정 구간이 무너진다. 정렬해 단조 증가를 보장한다.
  frames.sort((a, b) => a.t - b.t);

  const label =
    (typeof src.label === "string" && src.label) ||
    (typeof src.title === "string" && src.title) ||
    (typeof src.name === "string" && src.name) ||
    opts.labelHint ||
    opts.id;

  const note =
    (typeof src.intent === "string" && src.intent) ||
    (typeof src.note === "string" && src.note) ||
    (typeof src.description === "string" && src.description) ||
    opts.noteHint ||
    undefined;

  return {
    id: typeof src.id === "string" && src.id ? src.id : opts.id,
    label,
    motion,
    view,
    note,
    fps,
    aspect,
    frames,
    origin: opts.origin,
    originNote: typeof src.origin === "string" ? src.origin : undefined,
  };
}
