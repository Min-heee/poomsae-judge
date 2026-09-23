/**
 * 기준 자세(교본)의 33점 프레임 생성기.
 *
 * `docs/reference-poses.md` 6절이 정한 방법을 그대로 구현한다 —
 * **`rig.ts` 를 고치지 않고** 그 위에 팔만 덮어쓴다.
 *
 * 왜 덮어쓰기인가: `rig.ts` 의 `fillCosmetic` 은 모든 프레임에 같은 가드 자세를 박는다.
 * 막기 자세는 팔이 본체라 팔을 따로 세워야 하는데, `fillCosmetic` 을 고치면
 * 공개 샘플 7종의 **바이트가 달라져** `samples.test.ts` 의 골든 테스트가 전부 깨진다.
 * 그래서 리그는 읽기만 하고, 만든 프레임의 팔 랜드마크만 이 파일이 바꾼다.
 *
 * 좌표계는 리그와 같다: 미터, 엉덩이 중점이 원점, y는 아래로 증가,
 * 정면 빌드에서 +x = 사람의 왼쪽 / −z = 카메라 쪽(앞).
 *
 * 이 파일은 순수 함수만 둔다. `Date.now()`·`Math.random()`을 쓰지 않으므로
 * 같은 id면 언제나 같은 프레임이 나온다.
 */

import type { CameraView, Landmark, MotionKind, TimedFrame } from "../judge/types";
import { LM } from "../judge/landmarks";
import { sampleKeyframes, type Keyframe } from "./motion";
import {
  SEGMENT,
  add,
  buildKickFrame,
  buildStanceFrame,
  scale,
  v3,
  type KickParams,
  type StanceParams,
  type Vec3,
} from "./rig";

export type ReferencePoseId =
  | "ready"
  | "juchum"
  | "arae-makki"
  | "momtong-an-makki"
  | "ap-chagi-apex";

export const REFERENCE_POSE_IDS: readonly ReferencePoseId[] = [
  "ready",
  "juchum",
  "arae-makki",
  "momtong-an-makki",
  "ap-chagi-apex",
];

/**
 * 어깨→손목 거리가 팔 길이의 이 비율을 넘으면 던진다.
 *
 * 2링크 IK는 닿지 않는 목표를 **조용히 클램프**한다 — 아무도 모르는 사이에 다른 자세가
 * 만들어지고, 화면은 그것을 "교본"이라고 부른다. 기준 프레임은 도달 한계의 97%까지 쓰므로
 * (아래막기), 여유가 1%뿐이다. 조용히 틀리느니 소리 내어 실패한다.
 */
export const REACH_LIMIT = 0.98;

/**
 * 3D 2링크 역운동학. 어깨와 목표 손목이 주어지면 팔꿈치를 찾는다.
 *
 * `rig.ts` 의 `solveKnee` 와 같은 계산이되 **x–y 평면에 갇히지 않는다** —
 * 막기는 팔이 몸 앞(z)으로 나오기 때문이다. 팔꿈치는 어깨–손목 축을 도는 원 위에 있고,
 * `bendDir` 이 그 원 위의 한 점을 고른다(축 성분을 뺀 수직 성분만 쓴다).
 */
export function solveElbow3(
  shoulder: Vec3,
  wrist: Vec3,
  upper: number,
  fore: number,
  bendDir: Vec3,
): Vec3 {
  const d = { x: wrist.x - shoulder.x, y: wrist.y - shoulder.y, z: wrist.z - shoulder.z };
  const dist = Math.hypot(d.x, d.y, d.z);
  const reach = upper + fore;
  if (dist > reach * REACH_LIMIT) {
    throw new Error(
      `기준 자세의 주먹이 팔 길이 밖이다: 어깨→손목 ${dist.toFixed(3)}m, 팔 길이 ${reach.toFixed(3)}m ` +
        `(한계 ${(REACH_LIMIT * 100).toFixed(0)}% = ${(reach * REACH_LIMIT).toFixed(3)}m).`,
    );
  }
  if (dist === 0) {
    throw new Error("기준 자세의 손목이 어깨와 같은 자리다. 팔을 세울 수 없다.");
  }
  const a = (upper * upper - fore * fore + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, upper * upper - a * a));
  const u = { x: d.x / dist, y: d.y / dist, z: d.z / dist };
  const dot = bendDir.x * u.x + bendDir.y * u.y + bendDir.z * u.z;
  const perp = {
    x: bendDir.x - dot * u.x,
    y: bendDir.y - dot * u.y,
    z: bendDir.z - dot * u.z,
  };
  const len = Math.hypot(perp.x, perp.y, perp.z);
  if (len < 1e-9) {
    throw new Error("bendDir 이 어깨→손목 축과 평행하다. 팔꿈치가 향할 쪽을 정할 수 없다.");
  }
  const n = { x: perp.x / len, y: perp.y / len, z: perp.z / len };
  return {
    x: shoulder.x + u.x * a + n.x * h,
    y: shoulder.y + u.y * a + n.y * h,
    z: shoulder.z + u.z * a + n.z * h,
  };
}

/** 한 팔의 목표. 팔꿈치 각을 넣지 않고 **주먹이 갈 자리**를 넣는다(리그의 철학과 같다). */
export interface ArmTarget {
  /** 손목 목표 좌표(m, 엉덩이 중점 원점). */
  wrist: Vec3;
  /** 팔꿈치가 향하는 쪽. 크기는 무시하고 방향만 쓴다. */
  bendDir: Vec3;
}

export interface ArmPair {
  left: ArmTarget;
  right: ArmTarget;
}

/** 기준 자세 하나의 생성 파라미터. `docs/reference-poses.md` 6.3절 표가 이 자료다. */
export interface ReferenceRig {
  id: ReferencePoseId;
  labelKo: string;
  view: CameraView;
  /**
   * 이 자세에 판정 규칙이 있는가. `null` = 없다 = **점수가 없다.**
   * 주석이 아니라 타입으로 막는 자리다(`docs/reference-poses.md` 6.5절).
   */
  judgedMotion: MotionKind | null;
  lower:
    | { kind: "stance"; params: StanceParams }
    | { kind: "kick"; params: KickParams };
  /** `null` 이면 리그의 기본 가드 자세를 그대로 쓴다(앞차기 — 측면에서 팔은 몸에 가린다). */
  arms: ArmPair | null;
  /** 화면에 그대로 띄울 근거 한 줄. */
  sourceNote: string;
}

// 아래 좌표는 전부 docs/reference-poses.md 6.3절 표의 값이다.
// 손목 목표는 그 문서가 5절 표에서 약속한 측정값(주먹 높이·좌우)을 만족하도록 고른 것이고,
// bendDir 은 투영 팔꿈치 각이 5절 표와 맞도록 고른 것이다.
// 둘 다 이 파일에서 만든 프레임을 다시 재서 테스트가 확인한다 —
// 문서와 코드가 어긋나면 테스트가 깨지는 편이 낫다.

/** 주춤서기 하체. 발 간격 2.00 / 무릎 138° / 상체 0° — A1·A2의 합격대 한가운데다. */
const JUCHUM_LOWER: StanceParams = {
  feetGapRatio: 2.0,
  kneeAngleLeftDeg: 138,
  kneeAngleRightDeg: 138,
  torsoTiltDeg: 0,
};

/** 허리에 당긴 주먹. 좌우 대칭이라 준비·주춤·막기가 모두 같은 자리를 쓴다. */
const WAIST_FIST_LEFT: ArmTarget = {
  wrist: v3(0.17, -0.08, 0.03),
  bendDir: v3(1, 0, 0.6),
};
const WAIST_FIST_RIGHT: ArmTarget = {
  wrist: v3(-0.17, -0.08, 0.03),
  bendDir: v3(-1, 0, 0.6),
};

export const REFERENCE_RIGS: readonly ReferenceRig[] = [
  {
    id: "ready",
    labelKo: "기본준비서기",
    view: "frontal",
    judgedMotion: null,
    lower: {
      kind: "stance",
      params: {
        feetGapRatio: 0.9,
        kneeAngleLeftDeg: 178,
        kneeAngleRightDeg: 178,
        torsoTiltDeg: 0,
      },
    },
    arms: {
      left: { wrist: v3(0.08, 0.0, -0.16), bendDir: v3(1, 0.35, 0) },
      right: { wrist: v3(-0.08, 0.0, -0.16), bendDir: v3(-1, 0.35, 0) },
    },
    sourceNote:
      "두 발은 나란히, 두 주먹은 아랫배 앞. 무카스 이규현 칼럼(준비서기)과 Wikipedia 나란히서기를 합쳐 잡은 값이며 2차 자료다.",
  },
  {
    id: "juchum",
    labelKo: "주춤서기",
    view: "frontal",
    judgedMotion: "stance",
    lower: { kind: "stance", params: JUCHUM_LOWER },
    arms: { left: WAIST_FIST_LEFT, right: WAIST_FIST_RIGHT },
    sourceNote:
      "발 간격 2.00·S, 무릎 138°. 판정 A1(1.70~2.30)·A2(≤145°)의 합격대 한가운데다 — 교본대로 하면 감점이 없어야 한다.",
  },
  {
    id: "arae-makki",
    labelKo: "주춤서기 아래막기",
    view: "frontal",
    judgedMotion: null,
    lower: { kind: "stance", params: JUCHUM_LOWER },
    arms: {
      left: WAIST_FIST_LEFT,
      right: { wrist: v3(-0.25, 0.05, -0.08), bendDir: v3(-1, 0.5, -0.38) },
    },
    sourceNote:
      "오른팔로 내려 막고 왼 주먹은 허리로 당긴다. '무릎 위 한 주먹'은 이 골격에서 도달 불가라 '허벅지 바깥선까지 내려간 거의 편 팔'로 옮겼다(2차 자료).",
  },
  {
    id: "momtong-an-makki",
    labelKo: "주춤서기 몸통 안막기",
    view: "frontal",
    judgedMotion: null,
    lower: { kind: "stance", params: JUCHUM_LOWER },
    arms: {
      left: WAIST_FIST_LEFT,
      right: { wrist: v3(0.05, -0.42, -0.28), bendDir: v3(-0.6, 1, 0.1) },
    },
    sourceNote:
      "바깥에서 안으로 막아 주먹이 몸 중심선에 선다. 정면 투영이라 팔꿈치 각은 실제보다 굽어 보인다 — 그래서 이 항목만 밴드를 넓혔다(2차 자료).",
  },
  {
    id: "ap-chagi-apex",
    labelKo: "앞차기 정점",
    view: "sagittal",
    judgedMotion: "frontKick",
    lower: {
      kind: "kick",
      params: {
        kickHipDeg: 110,
        kickKneeDeg: 12,
        supportDriftDeg: 0,
        supportKneeDeg: 12,
        torsoLeanDeg: 8,
      },
    },
    arms: null,
    sourceNote:
      "무릎을 들어 올린 뒤 뻗은 정점 한 프레임. 순서(들기→뻗기→회수)는 비교하지 않는다 — 판정 규칙 B가 이미 말한다.",
  },
];

function rigFor(id: ReferencePoseId): ReferenceRig {
  const rig = REFERENCE_RIGS.find((r) => r.id === id);
  if (rig === undefined) throw new Error(`기준 자세 id 를 모른다: ${id}`);
  return rig;
}

function asVec(p: Landmark): Vec3 {
  return { x: p.x, y: p.y, z: p.z };
}

/**
 * 만들어진 프레임의 팔을 덮어쓴다.
 *
 * 13·14·15·16(팔꿈치·손목)을 목표대로 다시 놓고, 손가락 점(17~22)은 **손목이 움직인 만큼
 * 같이 옮긴다.** 문서는 13~16만 덮어쓰라고 적었지만, 손가락을 리그의 가드 자세에 두고 오면
 * 스켈레톤에서 손이 팔과 떨어져 그려진다(`POSE_EDGES` 가 15–17·15–19·15–21 을 잇는다).
 * 비교 층은 17~22를 읽지 않으므로 어떤 측정값도 바뀌지 않는다 — 그림만 성립한다.
 */
function overwriteArm(
  out: Landmark[],
  side: "left" | "right",
  target: ArmTarget,
): void {
  const idx =
    side === "left"
      ? {
          shoulder: LM.leftShoulder,
          elbow: LM.leftElbow,
          wrist: LM.leftWrist,
          hand: [LM.leftPinky, LM.leftIndex, LM.leftThumb],
        }
      : {
          shoulder: LM.rightShoulder,
          elbow: LM.rightElbow,
          wrist: LM.rightWrist,
          hand: [LM.rightPinky, LM.rightIndex, LM.rightThumb],
        };

  const shoulder = asVec(out[idx.shoulder]);
  const elbow = solveElbow3(shoulder, target.wrist, SEGMENT.upperArm, SEGMENT.forearm, target.bendDir);

  const oldWrist = asVec(out[idx.wrist]);
  const delta = {
    x: target.wrist.x - oldWrist.x,
    y: target.wrist.y - oldWrist.y,
    z: target.wrist.z - oldWrist.z,
  };

  out[idx.elbow] = { ...out[idx.elbow], x: elbow.x, y: elbow.y, z: elbow.z };
  out[idx.wrist] = { ...out[idx.wrist], x: target.wrist.x, y: target.wrist.y, z: target.wrist.z };
  for (const h of idx.hand) {
    out[h] = { ...out[h], x: out[h].x + delta.x, y: out[h].y + delta.y, z: out[h].z + delta.z };
  }
}

function buildFromRig(lower: ReferenceRig["lower"], arms: ArmPair | null): Landmark[] {
  const frame =
    lower.kind === "stance" ? buildStanceFrame(lower.params) : buildKickFrame(lower.params);
  if (arms === null) return frame;
  overwriteArm(frame, "left", arms.left);
  overwriteArm(frame, "right", arms.right);
  return frame;
}

/** 기준 자세 하나의 33점 프레임(world). 같은 id면 언제나 같은 좌표가 나온다. */
export function buildReferenceFrame(id: ReferencePoseId): Landmark[] {
  const rig = rigFor(id);
  return buildFromRig(rig.lower, rig.arms);
}

/**
 * 하체 파라미터 몇 개만 바꾼 기준 프레임.
 *
 * 쓰는 곳 둘.
 *  - **문제 변형**: 라운드마다 발 간격을 1.80 / 2.00 / 2.20 으로 바꾼다.
 *    합격대 안에서만 움직인다는 규칙은 여기가 아니라 `referencePoseVariant` 가 건다 —
 *    이 함수는 프레임을 만들 뿐이고, 플레이어 쪽 프레임도 같은 도구로 만들어야 하기 때문이다.
 *  - **테스트**: "한쪽 무릎만 어긋난 자세" 같은 입력을 교본과 같은 골격으로 만든다.
 *
 * 모르는 키가 오면 던진다. 주춤 자세에 `kickHipDeg` 를 넘기고 조용히 무시당하면,
 * 아무것도 안 바뀐 프레임을 "바꿨다"고 믿게 된다.
 */
export function buildReferenceFrameWith(
  id: ReferencePoseId,
  overrides: Partial<StanceParams> & Partial<KickParams>,
): Landmark[] {
  const rig = rigFor(id);
  const allowed = Object.keys(rig.lower.params);
  for (const key of Object.keys(overrides)) {
    if (!allowed.includes(key)) {
      throw new Error(
        `기준 자세 ${id} 는 ${key} 를 받지 않는다. 쓸 수 있는 것: ${allowed.join(", ")}.`,
      );
    }
  }
  const lower =
    rig.lower.kind === "stance"
      ? ({ kind: "stance", params: { ...rig.lower.params, ...overrides } } as const)
      : ({ kind: "kick", params: { ...rig.lower.params, ...overrides } } as const);
  return buildFromRig(lower, rig.arms);
}

// ---------------------------------------------------------------------------
// 시연 모드용 시퀀스 — 준비 → 목표 자세(유지) → 준비
// ---------------------------------------------------------------------------

/**
 * 키프레임 보간용 평면 파라미터.
 *
 * `sampleKeyframes` 는 모든 필드가 수인 객체만 받는다(문자열이 섞이면 보간이 말이 안 된다).
 * 그래서 하체 파라미터와 손목 목표를 한 줄로 편다. **bendDir 은 보간하지 않는다** —
 * 팔꿈치가 어느 쪽으로 굽는지는 자세의 성질이고, 중간에 뒤집히면 팔이 접혔다 펴진다.
 * 목표 자세의 bendDir 을 처음부터 끝까지 쓴다.
 */
interface FlatStancePose {
  feetGapRatio: number;
  kneeAngleLeftDeg: number;
  kneeAngleRightDeg: number;
  torsoTiltDeg: number;
  lwx: number;
  lwy: number;
  lwz: number;
  rwx: number;
  rwy: number;
  rwz: number;
}

function flatten(lower: StanceParams, arms: ArmPair): FlatStancePose {
  return {
    feetGapRatio: lower.feetGapRatio,
    kneeAngleLeftDeg: lower.kneeAngleLeftDeg,
    kneeAngleRightDeg: lower.kneeAngleRightDeg,
    torsoTiltDeg: lower.torsoTiltDeg,
    lwx: arms.left.wrist.x,
    lwy: arms.left.wrist.y,
    lwz: arms.left.wrist.z,
    rwx: arms.right.wrist.x,
    rwy: arms.right.wrist.y,
    rwz: arms.right.wrist.z,
  };
}

function unflatten(p: FlatStancePose, bend: ArmPair): { lower: StanceParams; arms: ArmPair } {
  return {
    lower: {
      feetGapRatio: p.feetGapRatio,
      kneeAngleLeftDeg: p.kneeAngleLeftDeg,
      kneeAngleRightDeg: p.kneeAngleRightDeg,
      torsoTiltDeg: p.torsoTiltDeg,
    },
    arms: {
      left: { wrist: v3(p.lwx, p.lwy, p.lwz), bendDir: bend.left.bendDir },
      right: { wrist: v3(p.rwx, p.rwy, p.rwz), bendDir: bend.right.bendDir },
    },
  };
}

export interface DemoSequenceOptions {
  fps?: number;
  /** 목표 자세를 몇 초 유지하는가. 게임이 요구하는 '맞춘 상태 유지'보다 길어야 한다. */
  holdSeconds?: number;
  /** 준비 자세에서 목표 자세까지 가는 데 걸리는 시간(초). */
  transitionSeconds?: number;
}

export interface DemoSequence {
  poseId: ReferencePoseId;
  view: CameraView;
  fps: number;
  frames: readonly TimedFrame[];
  /** 목표 자세를 유지하는 구간(ms). 게임의 정답 구간이 여기다. */
  holdFromMs: number;
  holdToMs: number;
}

/**
 * 판정 규칙이 없는 자세(준비·아래막기·안막기)의 시연 입력.
 *
 * 주춤서기·앞차기는 **공개 샘플 `stance-good`/`frontkick-good` 을 그대로 쓴다** —
 * 이미 커밋된 결정적 데이터가 있는데 새로 만들 이유가 없다. 그래서 이 함수는
 * 그 둘을 거부한다. 무엇을 흘려보낼지 고르는 것은 화면 계층의 일이고,
 * 잘못 부르면 조용히 다른 데이터를 주는 대신 던진다.
 *
 * `LandmarkSequence` 를 만들지 않는 것이 핵심이다 — 그 타입의 `motion` 은
 * `stance | frontKick` 둘뿐이고, **판정 타입을 넓히지 않는다.**
 */
export function referenceDemoFrames(
  id: ReferencePoseId,
  opts: DemoSequenceOptions = {},
): DemoSequence {
  const rig = rigFor(id);
  if (rig.judgedMotion !== null) {
    throw new Error(
      `${id} 는 시연 시퀀스를 만들지 않는다. 판정 규칙이 있는 자세는 이미 커밋된 ` +
        `공개 샘플(stance-good / frontkick-good)을 그대로 흘려보낸다.`,
    );
  }
  if (rig.lower.kind !== "stance" || rig.arms === null) {
    throw new Error(`${id} 의 리그가 주춤 계열이 아니라 보간 시퀀스를 만들 수 없다.`);
  }
  const { fps = 30, holdSeconds = 0.6, transitionSeconds = 0.8 } = opts;
  if (fps <= 0) throw new Error(`fps 가 ${fps} 다. 0보다 커야 한다.`);

  const ready = rigFor("ready");
  if (ready.lower.kind !== "stance" || ready.arms === null) {
    throw new Error("준비 자세 리그가 주춤 계열이 아니다.");
  }

  const from = flatten(ready.lower.params, ready.arms);
  const to = flatten(rig.lower.params, rig.arms);
  const holdFrom = transitionSeconds;
  const holdTo = holdFrom + holdSeconds;
  const total = holdTo + transitionSeconds;

  const keys: Keyframe<FlatStancePose>[] = [
    { t: 0, params: { ...from } },
    { t: holdFrom, params: { ...to } },
    { t: holdTo, params: { ...to } },
    { t: total, params: { ...from } },
  ];

  const dtMs = 1000 / fps;
  const count = Math.round(total * fps) + 1;
  const frames: TimedFrame[] = [];
  for (let i = 0; i < count; i++) {
    const p = sampleKeyframes(keys, i / fps);
    const { lower, arms } = unflatten(p, rig.arms);
    frames.push({
      t: Math.round(i * dtMs * 10) / 10,
      landmarks: buildFromRig({ kind: "stance", params: lower }, arms),
    });
  }

  return {
    poseId: id,
    view: rig.view,
    fps,
    frames,
    holdFromMs: Math.round(holdFrom * 1000),
    holdToMs: Math.round(holdTo * 1000),
  };
}

/** 리그가 쓰는 기준 길이 S. 어깨 너비는 자세와 무관하게 고정이다. */
export const RIG_SHOULDER_WIDTH_M = SEGMENT.shoulderWidth;

/** 팔 길이(어깨→손목 최대 도달). 도달 검사의 근거값이라 밖에서도 읽을 수 있게 둔다. */
export const RIG_ARM_REACH_M = SEGMENT.upperArm + SEGMENT.forearm;

/** 미사용 경고를 피하려고 두는 것이 아니라, 파생 파일이 같은 도구를 쓰게 하려고 다시 낸다. */
export { add, scale, v3 };
