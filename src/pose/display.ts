/**
 * 판정 결과를 화면에 그리기 위한 표시 규약.
 *
 * **숫자를 여기서 새로 정하지 않는다.** 경계값은 전부 `@/judge/constants` 에서
 * 읽어 온다(docs/PRD.md F7 — 상수 단일 출처). 이 파일이 아는 것은
 * "그 숫자를 어느 축 위에 어떻게 그릴 것인가"뿐이다.
 */

import {
  EPSILON,
  FRONT_KICK,
  METRIC_LABEL,
  REQUIRED_VIEW,
  STANCE,
  VIEW_LABEL_KO,
  WITHHOLD,
} from "@/judge/constants";
import { unitSuffix } from "@/judge/grading";
import { LM } from "@/judge/landmarks";
import type { CriterionResult, Grade, Judgement, MeasureUnit, MotionKind } from "@/judge/types";

export { unitSuffix };

/**
 * 항목 번호 → 그 규칙이 실제로 읽는 관절.
 *
 * 3D 뷰가 "판정이 어디를 봤는지"를 표시하는 데만 쓴다. 경계값이 아니라
 * **무엇을 재는가**의 목록이므로 규칙 상수와 달리 여기 두어도 두 벌이 되지 않는다.
 * 규칙 본문(`src/judge/stance.ts`·`frontKick.ts`)이 읽는 점과 맞춰 적었다.
 */
const CRITERION_JOINTS: Record<string, readonly number[]> = {
  // A1 발 간격 — 좌우 발목
  A1: [LM.leftAnkle, LM.rightAnkle],
  // A2 무릎 굽힘 — 엉덩이–무릎–발목 양쪽
  A2: [LM.leftHip, LM.leftKnee, LM.leftAnkle, LM.rightHip, LM.rightKnee, LM.rightAnkle],
  // A3 좌우 대칭 — 양 무릎
  A3: [LM.leftKnee, LM.rightKnee],
  // A4 상체 수직 — 어깨중점·엉덩이중점
  A4: [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip],
  // A5 유지·흔들림 — 엉덩이 높이를 발목 평균과 견준다
  A5: [LM.leftHip, LM.rightHip, LM.leftAnkle, LM.rightAnkle],
  // B1~B4·B7 은 차는 다리. 어느 쪽인지는 런타임에 정해지므로 양쪽을 준다.
  B1: [LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle],
  B2: [LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle],
  B3: [LM.leftAnkle, LM.rightAnkle, LM.leftHip, LM.rightHip],
  B4: [LM.leftHip, LM.leftKnee, LM.leftAnkle, LM.rightHip, LM.rightKnee, LM.rightAnkle],
  // B5 상체 젖힘 — 어깨·엉덩이
  B5: [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip],
  // B6 축발 흔들림 — 발목
  B6: [LM.leftAnkle, LM.rightAnkle],
  B7: [LM.leftKnee, LM.rightKnee],
};

/**
 * 감점·보류가 걸린 항목이 읽은 관절들.
 *
 * 3D 뷰에서 이 점들만 색을 달리 칠한다. 판정이 아무것도 짚지 않았으면 빈 배열이고,
 * 그때 3D 뷰는 평소 색으로만 그린다 — 근거가 없으면 강조도 없다.
 */
export function judgementJoints(judgement: Judgement | null): number[] {
  if (judgement === null) return [];
  const flagged = judgement.criteria.filter((c) => c.deduction > 0 || c.grade === "withheld");
  const out = new Set<number>();
  for (const c of flagged) {
    for (const j of CRITERION_JOINTS[c.id.slice(0, 2).toUpperCase()] ?? []) out.add(j);
  }
  return [...out].sort((a, b) => a - b);
}

export const GRADE_LABEL: Record<Grade, string> = {
  pass: "합격",
  minor: "0.1 감점",
  major: "0.3 감점",
  withheld: "항목 보류",
  unmeasured: "미측정",
};

/** CSS 클래스 접미사로 쓴다. */
export type GradeTone = "ok" | "warn" | "bad" | "hold" | "mute";

export const GRADE_TONE: Record<Grade, GradeTone> = {
  pass: "ok",
  minor: "warn",
  major: "bad",
  withheld: "hold",
  unmeasured: "mute",
};

/** 단위별 표시 소수 자리. 판정 코어의 반올림 자리수와 같게 맞춘다. */
const UNIT_DECIMALS: Record<MeasureUnit, number> = {
  deg: 1,
  ratio: 2,
  s: 2,
  m: 3,
  none: 0,
};

/** 단위 기호는 판정 코어의 `unitSuffix` 를 그대로 쓴다 — 표기가 두 벌이 되지 않게. */
export function formatMeasure(value: number | null, unit: MeasureUnit): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(UNIT_DECIMALS[unit])}${unitSuffix(unit)}`;
}

/**
 * 항목 ID → 감점 버킷 배열.
 *
 * 값을 옮겨 적지 않고 상수 모듈의 배열을 가리키기만 한다. 경계값 사이 구간 중
 * 감점 0인 칸이 합격대이고, 게이지의 초록 띠는 그 칸에서 계산된다.
 */
const DEDUCTION_BUCKETS: Record<string, readonly number[]> = {
  A1: STANCE.feetGapDeductions,
  A2: STANCE.kneeAngleDeductions,
  A3: STANCE.symmetryDeductions,
  A4: STANCE.torsoTiltDeductions,
  B3: FRONT_KICK.kickHeightDeductions,
  B4: FRONT_KICK.extensionAngleDeductions,
  B5: FRONT_KICK.torsoLeanDeductions,
  B6: FRONT_KICK.supportDriftDeductions,
  B7: FRONT_KICK.extendDelayDeductions,
};

export interface GaugeModel {
  /** 게이지 축의 양 끝 */
  axis: [number, number];
  /** 합격 구간. 없으면 null (상태 항목처럼 축이 없는 경우) */
  pass: [number, number] | null;
  /** 눈금 */
  ticks: number[];
  /** 측정값의 축 위 위치 (0~1). 값이 없으면 null */
  position: number | null;
}

/** 항목 ID 앞 두 글자로 버킷을 찾는다. "A2L" 같은 좌우 구분 접미사를 흡수한다. */
function bucketKey(id: string): string {
  return id.slice(0, 2).toUpperCase();
}

/**
 * 게이지 한 줄을 그리는 데 필요한 값들.
 *
 * 축 범위는 경계값에서 유도하고, 측정값이 그 밖으로 나가면 축을 넓힌다 —
 * 값이 게이지 끝에 붙어 "얼마나 벗어났는지"가 안 보이는 일을 막는다.
 */
export function gaugeModel(c: Pick<CriterionResult, "id" | "measured" | "boundaries">): GaugeModel {
  const bounds = [...c.boundaries].filter((b) => Number.isFinite(b)).sort((a, b) => a - b);
  if (bounds.length === 0) {
    return { axis: [0, 1], pass: null, ticks: [], position: null };
  }

  const first = bounds[0];
  const last = bounds[bounds.length - 1];
  const rawSpan = last - first;
  const span = rawSpan > 1e-9 ? rawSpan : Math.max(Math.abs(first) * 0.5, 1);
  const pad = span * 0.6;

  let lo = first - pad;
  let hi = last + pad;

  const m = c.measured;
  if (m !== null && Number.isFinite(m)) {
    const margin = span * 0.15;
    if (m < lo) lo = m - margin;
    if (m > hi) hi = m + margin;
  }

  // 감점 0인 칸을 찾아 합격 띠로 쓴다.
  let pass: [number, number] | null = null;
  const buckets = DEDUCTION_BUCKETS[bucketKey(c.id)];
  if (buckets && buckets.length === bounds.length + 1) {
    const idx = buckets.findIndex((d) => d === 0);
    if (idx >= 0) {
      const passLo = idx === 0 ? lo : bounds[idx - 1];
      const passHi = idx === bounds.length ? hi : bounds[idx];
      pass = [passLo, passHi];
    }
  }

  const position =
    m !== null && Number.isFinite(m) ? Math.min(1, Math.max(0, (m - lo) / (hi - lo))) : null;

  return { axis: [lo, hi], pass, ticks: bounds, position };
}

/** 축 위 값의 0~1 위치. 게이지 눈금과 합격 띠를 놓을 때 쓴다. */
export function axisRatio(value: number, axis: [number, number]): number {
  const [lo, hi] = axis;
  if (hi - lo < 1e-9) return 0;
  return Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
}

/* ── 앱 안에서 읽는 규칙 표 (docs/PRD.md F7) ──────────────────────── */

export interface RuleRow {
  id: string;
  title: string;
  metric: string;
  pass: string;
  minor: string;
  major: string;
}

const g = STANCE.feetGapBoundaries;
const k = STANCE.kneeAngleBoundaries;
const s = STANCE.symmetryBoundaries;
const t = STANCE.torsoTiltBoundaries;
const kh = FRONT_KICK.kickHeightBoundaries;
const ex = FRONT_KICK.extensionAngleBoundaries;
const ln = FRONT_KICK.torsoLeanBoundaries;

export const RULE_TABLE: Record<MotionKind, { title: string; rows: RuleRow[] }> = {
  stance: {
    title: "규칙 A — 주춤서기",
    rows: [
      {
        id: "A1",
        title: "발 간격",
        metric: "좌우 발목 수평거리 ÷ 어깨너비 S",
        pass: `${g[1].toFixed(2)} ~ ${g[2].toFixed(2)}`,
        minor: `${g[0].toFixed(2)}~${g[1].toFixed(2)}, ${g[2].toFixed(2)}~${g[3].toFixed(2)}`,
        major: "그 밖",
      },
      {
        id: "A2",
        title: "무릎 굽힘",
        metric: "엉덩이–무릎–발목 내각 (나쁜 쪽)",
        pass: `≤ ${k[0]}°`,
        minor: `${k[0]} ~ ${k[1]}°`,
        major: `> ${k[1]}°`,
      },
      {
        id: "A3",
        title: "좌우 대칭",
        metric: "좌우 무릎 내각의 차",
        pass: `≤ ${s[0]}°`,
        minor: `${s[0]} ~ ${s[1]}°`,
        major: `> ${s[1]}°`,
      },
      {
        id: "A4",
        title: "상체 수직",
        metric: "엉덩이중점→어깨중점 벡터와 수직축의 각",
        pass: `≤ ${t[0]}°`,
        minor: `${t[0]} ~ ${t[1]}°`,
        major: `> ${t[1]}°`,
      },
      {
        id: "A5",
        title: "유지·흔들림",
        metric: `멈춘 구간 길이 / 그 구간 ${METRIC_LABEL.hipSway}`,
        pass: `≥ ${STANCE.minHoldSeconds}초 & ≤ ${STANCE.maxHipSwayRatio}·S`,
        minor: "미충족",
        major: "—",
      },
    ],
  },
  frontKick: {
    title: "규칙 B — 앞차기",
    rows: [
      {
        id: "B1",
        title: "순서 위반",
        metric: `무릎 들기(내각 ≤ ${FRONT_KICK.chamberKneeAngleMax}°) 없이 뻗기 도달`,
        pass: "S1 → S2 순서 유지",
        minor: "—",
        major: `${FRONT_KICK.orderViolationDeduction.toFixed(1)}`,
      },
      {
        id: "B2",
        title: "회수 생략",
        metric: `정점 뒤 무릎이 ${FRONT_KICK.retractKneeAngleMax}° 이하로 다시 접히는가`,
        pass: "S3 경유",
        minor: "—",
        major: `${FRONT_KICK.noRetractDeduction.toFixed(1)}`,
      },
      {
        id: "B3",
        title: "높이 부족",
        metric: "정점 프레임 (발목 높이 − 엉덩이 높이) ÷ S",
        pass: `≥ ${kh[1]}`,
        minor: `${kh[0]} ~ ${kh[1]}`,
        major: `< ${kh[0]}`,
      },
      {
        id: "B4",
        title: "펴짐 부족",
        metric: "정점 프레임의 무릎 내각",
        pass: `≥ ${ex[1]}°`,
        minor: `${ex[0]} ~ ${ex[1]}°`,
        major: `< ${ex[0]}°`,
      },
      {
        id: "B5",
        title: "상체 젖힘",
        metric: "정점 프레임에서 차는 방향 반대로 기운 각",
        pass: `≤ ${ln[0]}°`,
        minor: `${ln[0]} ~ ${ln[1]}°`,
        major: `> ${ln[1]}°`,
      },
      {
        id: "B6",
        title: "축발 흔들림",
        metric: "축발 발목 수평 이동폭 ÷ S",
        pass: `≤ ${FRONT_KICK.supportDriftBoundaries[0]}`,
        minor: `> ${FRONT_KICK.supportDriftBoundaries[0]}`,
        major: "—",
      },
      {
        id: "B7",
        title: "뻗기 지연",
        metric: "들기 → 정점 소요 시간",
        pass: `≤ ${FRONT_KICK.extendDelayBoundaries[0]}초`,
        minor: `> ${FRONT_KICK.extendDelayBoundaries[0]}초`,
        major: "—",
      },
    ],
  },
};

/**
 * 보류 규칙. 규칙 표 아래에 같이 띄운다.
 *
 * **실제로 작동하는 경계는 하나도 빠뜨리지 않는다.** H4의 ε는 각도·비율만이
 * 아니다 — 시간 지표(B7 뻗기 지연, A5 유지 시간)에는 초 단위 ε가, 문턱 자체가
 * 아주 작은 지표(A5 흔들림)에는 문턱 대비 상대 ε가 걸린다. 화면에서 "왜 이
 * 항목만 빠졌는가"를 눌러 본 사람이 규칙 표에서 그 근거를 찾지 못하면,
 * 경계값을 드러내겠다는 약속(PRD 1절)이 그 자리에서 깨진다.
 */
export const HOLD_RULES: { code: string; text: string }[] = [
  {
    code: "H1",
    text: `필수 8점(어깨·엉덩이·무릎·발목) 중 하나라도 visibility < ${WITHHOLD.minVisibility} → 그 프레임 무효`,
  },
  {
    code: "H2",
    text: `무효 프레임 비율 > ${(WITHHOLD.maxInvalidRatio * 100).toFixed(0)}% → 전체 보류`,
  },
  {
    code: "H3",
    text: `인접 프레임 간격 > ${WITHHOLD.maxFrameGapMs}ms → 보류 (그 이하는 선형 보간으로 메움)`,
  },
  {
    code: "H4",
    text:
      `지표가 등급 경계의 ±ε 안 → 그 항목만 보류하고 총점에서 제외. ` +
      `ε는 각도 ${EPSILON.deg}°, 비율 ${EPSILON.ratio}·S, 시간 ${EPSILON.seconds}초, ` +
      `그리고 문턱이 아주 작은 지표(A5 흔들림)는 문턱의 ±${EPSILON.relative * 100}%`,
  },
  {
    code: "H5",
    text: `항목 보류가 ${WITHHOLD.maxWithheldCriteria}개 이상 → 전체 판정 보류`,
  },
  {
    code: "H6",
    text:
      `선언된 카메라 각도가 규칙의 전제와 다름 → 전체 보류 ` +
      `(주춤서기 ${VIEW_LABEL_KO[REQUIRED_VIEW.stance]}, 앞차기 ${VIEW_LABEL_KO[REQUIRED_VIEW.frontKick]} 전제)`,
  },
  {
    code: "H7",
    text:
      `주춤서기로 볼 멈춘 구간이 없음 → 전체 보류 ` +
      `(양쪽 무릎 ${STANCE.engagedKneeAngleMax}° 이하 · 발 간격 ${STANCE.engagedFeetGapMin}·S 이상 · ` +
      `엉덩이 상하 속도 ${STANCE.settleSpeedMaxMps}m/s 이하인 프레임이 하나도 없음)`,
  },
];

/**
 * 숫자 뒤에 붙는 '으로 / 로'.
 *
 * 받침이 있으면 '으로'지만 **ㄹ 받침은 예외**라 '로'를 쓴다. 숫자를 한국어로 읽으면
 * 1(일)·7(칠)·8(팔)이 ㄹ로 끝나므로 '일로·칠로·팔로'다. 결국 '으로'가 붙는 끝자리는
 * 0(영/십)·3(삼)·6(육) 셋뿐이다.
 *
 * 작은 것이지만 전부 한국어로 쓴 화면에서 심사위원이 가장 많이 누르는 버튼의
 * 라벨이라, 여기가 어긋나면 나머지 문장의 공들임까지 의심받는다.
 */
export function euroRo(n: number): string {
  const last = Math.abs(Math.trunc(n)) % 10;
  return last === 0 || last === 3 || last === 6 ? "으로" : "로";
}
