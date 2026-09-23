/**
 * 자세별 비교 지표의 정의.
 *
 * `docs/reference-poses.md` 5절의 표를 코드로 옮긴 것이되, **목표값은 옮기지 않았다.**
 * 목표값은 기준 프레임에서 재서 만든다(`reference.ts`). 문서의 숫자는 그 계산이 맞는지
 * 보는 시험값이고, 어긋나면 테스트가 깨진다 — 문서와 코드가 조용히 갈라지는 것보다 낫다.
 *
 * 비교에 쓰는 점은 33개 중 12개뿐이다(어깨·팔꿈치·손목·엉덩이·무릎·발목).
 * 얼굴(0~10)·손가락(17~22)·뒤꿈치와 발끝(29~32)은 읽지 않는다 —
 * 판정이 이미 같은 이유로 읽지 않는 점들이다.
 */

import { angleAtVertexXY, signedBackwardTiltXY, tiltFromVerticalXY } from "../judge/math";
import { height } from "../judge/coords";
import { LM } from "../judge/landmarks";
import {
  ANGLE_BAND,
  ARM_ANGLE_BAND,
  FEET_GAP_BAND,
  KNEE_SPREAD_BAND,
  LENGTH_BAND,
  MOMTONG_ELBOW_BAND,
  type Band,
} from "./bands";
import type { BodySide, MetricSpec, NormalizedFrame, ReferencePoseId } from "./types";

/**
 * 정규화 자체가 기대는 네 점.
 *
 * 엉덩이 중점(23·24)이 원점이고 어깨 너비(11·12)가 축척이다 — 이 넷 중 하나라도 흐리면
 * **모든** 지표의 값이 흔들린다. 지표마다 이 넷을 다시 적는 대신 한 번만 검사하고,
 * 걸리면 비교 전체를 "읽지 못했다"로 돌린다. 지표별 `reads` 는 그 지표만의 점을 적는다.
 */
export const FRAME_ANCHORS: readonly number[] = [
  LM.leftShoulder,
  LM.rightShoulder,
  LM.leftHip,
  LM.rightHip,
];

// --- 정규화 프레임에서 값을 읽는 도구 ---------------------------------------
// 정규화 프레임은 엉덩이 중점이 원점이고 길이가 ÷S 이므로,
// 높이·좌우는 그대로 읽으면 되고 각도는 원본과 같다(균등 축척·평행이동에 불변).

function ang(f: NormalizedFrame, a: number, vertex: number, b: number): number {
  return angleAtVertexXY(f.points[a], f.points[vertex], f.points[b]);
}

/** 엉덩이 중점 대비 높이(÷S). 정규화 프레임에서는 원점이 엉덩이라 그대로다. */
function h(f: NormalizedFrame, i: number): number {
  return height(f.points[i]);
}

/** 몸 중심선 대비 좌우(÷S). 부호를 남긴다 — +x 가 사람의 왼쪽이다. */
function x(f: NormalizedFrame, i: number): number {
  return f.points[i].x;
}

function shoulderMidPoint(f: NormalizedFrame): { x: number; y: number } {
  return {
    x: (f.points[LM.leftShoulder].x + f.points[LM.rightShoulder].x) / 2,
    y: (f.points[LM.leftShoulder].y + f.points[LM.rightShoulder].y) / 2,
  };
}

/** 상체가 수직에서 벗어난 각(부호 없음). 판정 A4와 같은 계산이다. */
function torsoTilt(f: NormalizedFrame): number {
  const s = shoulderMidPoint(f);
  return tiltFromVerticalXY(s.x, s.y);
}

function kneeL(f: NormalizedFrame): number {
  return ang(f, LM.leftHip, LM.leftKnee, LM.leftAnkle);
}

function kneeR(f: NormalizedFrame): number {
  return ang(f, LM.rightHip, LM.rightKnee, LM.rightAnkle);
}

/** 좌우 발목의 수평 거리(÷S). 판정 A1이 재는 값과 같다. */
function feetGap(f: NormalizedFrame): number {
  return Math.abs(x(f, LM.leftAnkle) - x(f, LM.rightAnkle));
}

/**
 * 차는 방향의 부호. 정점에서 차는 발은 몸 앞에 있으므로, 그 발의 x 부호가 곧 앞이다.
 *
 * 관측으로 정한다 — 측면 촬영은 사람이 어느 쪽을 보고 서든 성립해야 하고,
 * "오른쪽을 보고 선다"를 상수로 박으면 반대로 선 사람의 상체 젖힘 부호가 뒤집힌다.
 * 발이 몸 바로 아래면(x ≈ 0) 방향을 말할 수 없으므로 NaN 을 돌려 이 지표만 읽지 않는다.
 */
function kickForwardSign(f: NormalizedFrame): number {
  const dx = x(f, LM.rightAnkle);
  if (!Number.isFinite(dx) || Math.abs(dx) < 1e-6) return Number.NaN;
  return dx > 0 ? 1 : -1;
}

// --- 지표 만들기 도우미 ------------------------------------------------------

/** 사람의 몸 기준 좌우 이름. 화면의 좌우가 아니다. */
export const SIDE_LABEL_KO: Readonly<Record<BodySide, string>> = {
  left: "왼쪽",
  right: "오른쪽",
};

export function sideLabel(base: string, side: BodySide | null): string {
  return side === null ? base : `${SIDE_LABEL_KO[side]} ${base}`;
}

function spec(
  id: string,
  baseLabelKo: string,
  unit: MetricSpec["unit"],
  band: Band,
  weight: number,
  reads: readonly number[],
  joints: readonly number[],
  measure: (f: NormalizedFrame) => number,
  hintKo: string,
  side: BodySide | null = null,
): MetricSpec {
  return {
    id,
    baseLabelKo,
    side,
    labelKo: sideLabel(baseLabelKo, side),
    unit,
    ok: band.ok,
    warn: band.warn,
    weight,
    reads,
    joints,
    measure,
    hintKo,
  };
}

/** 좌우 대칭인 지표 한 쌍. 표의 한 줄("좌·우 각각")이 가중치를 반씩 나눠 갖는다. */
function pair(
  base: string,
  labelKo: string,
  unit: MetricSpec["unit"],
  band: Band,
  rowWeight: number,
  left: { reads: readonly number[]; joints: readonly number[]; measure: (f: NormalizedFrame) => number },
  right: { reads: readonly number[]; joints: readonly number[]; measure: (f: NormalizedFrame) => number },
  hintKo: string,
): MetricSpec[] {
  return [
    spec(`${base}-left`, labelKo, unit, band, rowWeight / 2, left.reads, left.joints, left.measure, hintKo, "left"),
    spec(`${base}-right`, labelKo, unit, band, rowWeight / 2, right.reads, right.joints, right.measure, hintKo, "right"),
  ];
}

const LEG_L = [LM.leftHip, LM.leftKnee, LM.leftAnkle] as const;
const LEG_R = [LM.rightHip, LM.rightKnee, LM.rightAnkle] as const;
const ARM_L = [LM.leftShoulder, LM.leftElbow, LM.leftWrist] as const;
const ARM_R = [LM.rightShoulder, LM.rightElbow, LM.rightWrist] as const;

/** 좌우 무릎 중 **덜 굽은 쪽**(= 나쁜 쪽). 판정 A2와 같은 규약이다. */
function worstKnee(f: NormalizedFrame): number {
  const l = kneeL(f);
  const r = kneeR(f);
  if (!Number.isFinite(l) || !Number.isFinite(r)) return Number.NaN;
  return Math.max(l, r);
}

const LOWER_KNEE = (weight: number): MetricSpec =>
  spec(
    "lower-knee",
    "하체 주춤서기 무릎",
    "deg",
    ANGLE_BAND,
    weight,
    [...LEG_L, ...LEG_R],
    [LM.leftKnee, LM.rightKnee],
    worstKnee,
    "무릎을 더 굽혀 주춤서기를 유지하세요.",
  );

const TORSO_UPRIGHT = (weight: number): MetricSpec =>
  spec(
    "torso-tilt",
    "상체 수직",
    "deg",
    ANGLE_BAND,
    weight,
    [],
    [LM.leftShoulder, LM.rightShoulder],
    torsoTilt,
    "허리를 세우고 몸을 곧게 하세요.",
  );

const WAIST_FIST = (rowWeight: number): MetricSpec[] =>
  pair(
    "waist-fist-height",
    "허리 주먹 높이",
    "ratio",
    LENGTH_BAND,
    rowWeight,
    { reads: [LM.leftWrist], joints: [LM.leftWrist], measure: (f) => h(f, LM.leftWrist) },
    { reads: [LM.rightWrist], joints: [LM.rightWrist], measure: (f) => h(f, LM.rightWrist) },
    "주먹을 허리 높이로 당기세요.",
  );

// --- 자세별 지표 -------------------------------------------------------------
// 가중치는 전부 제안값이다. 태권도의 중요도가 아니라 "게임이 재밌으려면"으로 정했고,
// 자세마다 합이 100이다(테스트가 확인한다).

const READY_METRICS: readonly MetricSpec[] = [
  ...pair("knee", "무릎", "deg", ANGLE_BAND, 10,
    { reads: LEG_L, joints: [LM.leftKnee], measure: kneeL },
    { reads: LEG_R, joints: [LM.rightKnee], measure: kneeR },
    "무릎을 펴고 곧게 서세요."),
  TORSO_UPRIGHT(15),
  ...pair("elbow", "팔꿈치", "deg", ARM_ANGLE_BAND, 20,
    { reads: ARM_L, joints: [LM.leftElbow], measure: (f) => ang(f, LM.leftShoulder, LM.leftElbow, LM.leftWrist) },
    { reads: ARM_R, joints: [LM.rightElbow], measure: (f) => ang(f, LM.rightShoulder, LM.rightElbow, LM.rightWrist) },
    "팔을 조금 더 펴 주먹을 아랫배 앞으로 내리세요."),
  ...pair("fist-height", "주먹 높이", "ratio", LENGTH_BAND, 20,
    { reads: [LM.leftWrist], joints: [LM.leftWrist], measure: (f) => h(f, LM.leftWrist) },
    { reads: [LM.rightWrist], joints: [LM.rightWrist], measure: (f) => h(f, LM.rightWrist) },
    "주먹을 아랫배 앞으로 내리세요."),
  ...pair("fist-lateral", "주먹 좌우", "ratio", LENGTH_BAND, 10,
    { reads: [LM.leftWrist], joints: [LM.leftWrist], measure: (f) => Math.abs(x(f, LM.leftWrist)) },
    { reads: [LM.rightWrist], joints: [LM.rightWrist], measure: (f) => Math.abs(x(f, LM.rightWrist)) },
    "두 주먹 사이를 주먹 하나만큼 두세요."),
  spec("feet-gap", "발 간격", "ratio", FEET_GAP_BAND, 25, [LM.leftAnkle, LM.rightAnkle],
    [LM.leftAnkle, LM.rightAnkle], feetGap, "두 발을 나란히, 한 발바닥만큼 벌리세요."),
];

const JUCHUM_METRICS: readonly MetricSpec[] = [
  ...pair("knee", "무릎", "deg", ANGLE_BAND, 20,
    { reads: LEG_L, joints: [LM.leftKnee], measure: kneeL },
    { reads: LEG_R, joints: [LM.rightKnee], measure: kneeR },
    "무릎을 더 굽혀 앉으세요."),
  spec("knee-symmetry", "좌우 대칭", "deg", ANGLE_BAND, 10, [...LEG_L, ...LEG_R],
    [LM.leftKnee, LM.rightKnee],
    (f) => Math.abs(kneeL(f) - kneeR(f)),
    "체중을 양발에 고르게 싣고 두 무릎을 같은 높이로 두세요."),
  spec("feet-gap", "발 간격", "ratio", FEET_GAP_BAND, 25, [LM.leftAnkle, LM.rightAnkle],
    [LM.leftAnkle, LM.rightAnkle], feetGap, "발을 어깨 너비의 두 배로 벌리세요."),
  // 무릎 벌림은 발끝 방향의 **대리 지표**다. 무릎이 안으로 모이는 것만 잡고,
  // 발끝이 어디를 보는지는 모른다(판정의 A-nm1과 같은 이유). 화면에도 그렇게 적는다.
  spec("knee-spread", "무릎 벌림", "ratio", KNEE_SPREAD_BAND, 15,
    [LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle],
    [LM.leftKnee, LM.rightKnee],
    (f) => {
      const ankle = feetGap(f);
      if (!Number.isFinite(ankle) || ankle < 1e-6) return Number.NaN;
      return Math.abs(x(f, LM.leftKnee) - x(f, LM.rightKnee)) / ankle;
    },
    "무릎을 바깥으로 밀어 발끝 방향과 맞추세요."),
  TORSO_UPRIGHT(15),
  ...WAIST_FIST(15),
];

const ARAE_MAKKI_METRICS: readonly MetricSpec[] = [
  spec("block-elbow", "막는 팔 팔꿈치", "deg", ARM_ANGLE_BAND, 20, ARM_R, [LM.rightElbow],
    (f) => ang(f, LM.rightShoulder, LM.rightElbow, LM.rightWrist),
    "막는 팔을 거의 다 펴세요."),
  spec("block-shoulder-spread", "막는 팔 어깨 벌림", "deg", ARM_ANGLE_BAND, 15,
    [LM.rightHip, LM.rightShoulder, LM.rightElbow], [LM.rightShoulder],
    (f) => ang(f, LM.rightHip, LM.rightShoulder, LM.rightElbow),
    "팔을 몸에서 살짝 띄워 허벅지 바깥선으로 내리세요."),
  spec("block-fist-height", "막는 주먹 높이", "ratio", LENGTH_BAND, 20, [LM.rightWrist], [LM.rightWrist],
    (f) => h(f, LM.rightWrist), "팔만 내리고 허리는 세우세요."),
  spec("block-fist-lateral", "막는 주먹 좌우", "ratio", LENGTH_BAND, 10, [LM.rightWrist], [LM.rightWrist],
    (f) => Math.abs(x(f, LM.rightWrist)), "주먹을 허벅지 바깥선까지 내리세요."),
  spec("pull-fist-height", "당기는 주먹 높이", "ratio", LENGTH_BAND, 15, [LM.leftWrist], [LM.leftWrist],
    (f) => h(f, LM.leftWrist), "반대 주먹을 허리로 당기세요."),
  LOWER_KNEE(20),
];

const MOMTONG_AN_MAKKI_METRICS: readonly MetricSpec[] = [
  spec("block-fist-height", "막는 주먹 높이", "ratio", LENGTH_BAND, 30, [LM.rightWrist], [LM.rightWrist],
    (f) => h(f, LM.rightWrist), "주먹을 어깨보다 조금 낮게 세우세요."),
  // 이 지표만 부호를 남긴다. 중심선을 **지나친** 것과 **못 미친** 것은 고치는 방법이 반대다.
  spec("block-fist-lateral", "막는 주먹 좌우", "ratio", LENGTH_BAND, 20, [LM.rightWrist], [LM.rightWrist],
    (f) => x(f, LM.rightWrist), "주먹을 몸 가운데에서 멈추세요."),
  spec("block-elbow-height", "막는 팔꿈치 높이", "ratio", LENGTH_BAND, 10, [LM.rightElbow], [LM.rightElbow],
    (f) => h(f, LM.rightElbow), "팔꿈치를 몸 앞에 두세요."),
  spec("block-elbow-angle", "막는 팔 팔꿈치 각", "deg", MOMTONG_ELBOW_BAND, 15, ARM_R, [LM.rightElbow],
    (f) => ang(f, LM.rightShoulder, LM.rightElbow, LM.rightWrist),
    "팔꿈치를 직각 가까이 접으세요."),
  spec("pull-fist-height", "당기는 주먹 높이", "ratio", LENGTH_BAND, 10, [LM.leftWrist], [LM.leftWrist],
    (f) => h(f, LM.leftWrist), "반대 주먹을 허리로 당기세요."),
  LOWER_KNEE(15),
];

const AP_CHAGI_METRICS: readonly MetricSpec[] = [
  spec("kick-knee", "차는 다리 무릎", "deg", ANGLE_BAND, 25, LEG_R, [LM.rightKnee],
    kneeR, "정점에서 무릎을 끝까지 펴세요."),
  spec("foot-height", "발 높이", "ratio", LENGTH_BAND, 25, [LM.rightAnkle], [LM.rightAnkle],
    (f) => h(f, LM.rightAnkle), "발을 엉덩이 높이 위로 올리세요."),
  spec("knee-height", "무릎 높이", "ratio", LENGTH_BAND, 15, [LM.rightKnee], [LM.rightKnee],
    (f) => h(f, LM.rightKnee), "무릎을 먼저 가슴까지 들어 올리세요."),
  spec("hip-flex", "엉덩이 굴곡", "deg", ANGLE_BAND, 15, [LM.rightKnee], [LM.rightHip],
    (f) => {
      const s = shoulderMidPoint(f);
      return angleAtVertexXY(
        { x: s.x, y: s.y, z: 0, visibility: 1 },
        { x: 0, y: 0, z: 0, visibility: 1 },
        f.points[LM.rightKnee],
      );
    },
    "무릎을 더 높이 끌어올리세요."),
  spec("support-knee", "축발 무릎", "deg", ANGLE_BAND, 10, LEG_L, [LM.leftKnee],
    kneeL, "축발을 펴서 버티세요."),
  // 뒤로 젖힌 것이 +다. 앞으로 숙인 것은 음수로 나오고 목표(+8°)에서 그만큼 멀어진다 —
  // 판정 B5가 앞으로 숙인 것을 0으로 접는 것과 다르다. 비교는 감점이 아니라 차이를 말한다.
  spec("torso-lean", "상체 기울기", "deg", ANGLE_BAND, 10, [LM.rightAnkle],
    [LM.leftShoulder, LM.rightShoulder],
    (f) => {
      const sign = kickForwardSign(f);
      if (!Number.isFinite(sign)) return Number.NaN;
      const s = shoulderMidPoint(f);
      return signedBackwardTiltXY(s.x, s.y, sign);
    },
    "허리를 세우고 상체를 너무 젖히지 마세요."),
];

export const METRIC_SPECS: Readonly<Record<ReferencePoseId, readonly MetricSpec[]>> = {
  ready: READY_METRICS,
  juchum: JUCHUM_METRICS,
  "arae-makki": ARAE_MAKKI_METRICS,
  "momtong-an-makki": MOMTONG_AN_MAKKI_METRICS,
  "ap-chagi-apex": AP_CHAGI_METRICS,
};

/** 한 자세의 가중치 합. 100이어야 한다 — 테스트가 지킨다. */
export function weightSum(specs: readonly MetricSpec[]): number {
  return specs.reduce((sum, s) => sum + s.weight, 0);
}
