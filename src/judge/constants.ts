/**
 * 판정 상수의 단일 출처 (PRD F7).
 *
 * 화면의 규칙 표, 판정 코어, 테스트가 전부 이 파일 하나를 읽는다.
 * 여기 숫자 하나를 고치면 세 곳이 함께 바뀌어야 하고, 안 바뀌면 테스트가 깨진다.
 *
 * 값을 고를 때 지킨 것:
 *  - 길이는 전부 어깨 너비 S로 나눈 비율이다. 키와 카메라 거리에 무관해진다.
 *  - 각도는 화면 평면(x–y)에서만 잰다. 단일 카메라의 z는 상대값이라 믿지 않는다.
 *  - 경계값은 사람이 자료를 보고 정했고, AI에게 정하게 하지 않았다(PRD 7절).
 *  - 이 값들은 연맹 채점표의 재현이 아니라 이 프로젝트가 정한 값이다.
 */

import type { CameraView, MotionKind } from "./types";

/** 규칙표 버전. 경계값이나 감점이 바뀌면 올린다. 과거 판정과 섞이지 않게 하는 표시다. */
export const RULES_VERSION = "A/B-1.0.0";

/** 동작 하나의 만점. 여기서 감점을 뺀다. */
export const MAX_SCORE = 10.0;

/**
 * 화면에 쓰는 한국어 이름. 판정 코어에 두는 이유는 하나다 —
 * 판정이 내는 문장(`withheld` 메시지 등)에도 같은 이름이 들어가야 하고,
 * 이름이 두 벌이 되면 화면과 판정이 다른 말을 하게 된다.
 */
export const MOTION_LABEL_KO: Record<MotionKind, string> = {
  stance: "주춤서기",
  frontKick: "앞차기",
};

export const VIEW_LABEL_KO: Record<CameraView, string> = {
  frontal: "정면",
  sagittal: "측면",
};

/**
 * 규칙마다 전제하는 카메라 각도 (H6).
 *
 * 규칙의 각도·비율은 전부 화면 평면(x–y)에서 잰다. 그래서 "어느 평면이
 * 화면 평면인가"가 규칙의 전제다. 주춤서기의 발 간격은 정면에서만 x축에
 * 나타나고, 앞차기의 상체 젖힘은 측면에서만 x축에 나타난다.
 *
 * 카메라 각도는 33개 랜드마크로 관측할 수 없다. 그래서 **시퀀스가 스스로
 * 선언한 값**(`LandmarkSequence.view`)을 믿되, 그 선언이 규칙의 전제와 다르면
 * 채점하지 않는다. 틀린 평면에서 잰 값으로 자신만만한 점수를 내는 것이
 * 이 프로젝트가 가장 피하려는 결과다.
 */
export const REQUIRED_VIEW = {
  stance: "frontal",
  frontKick: "sagittal",
} as const satisfies Record<MotionKind, CameraView>;

/**
 * 지표 이름의 단일 출처.
 *
 * A5의 정의는 한 번 틀렸던 자리다. 초안은 "엉덩이 높이의 표준편차"라고 적었지만
 * worldLandmarks 는 엉덩이 중점이 원점이라 그 값은 정의상 항상 0이다 —
 * 적힌 대로 구현하면 A5 흔들림은 어떤 입력에서도 통과한다. 실제로 재는 것은
 * 아래 문장이고, 화면의 규칙 표와 판정의 근거 문장이 같은 상수를 읽는다.
 */
export const METRIC_LABEL = {
  /** A5 흔들림. 원점이 무엇이든 같은 값이 나온다. */
  hipSway: "양 발목 평균 높이 대비 엉덩이 높이의 표준편차",
} as const;

/** 감점 두 단계. PRD 5절 표의 "0.1 감점", "0.3 감점"에 대응한다. */
export const DEDUCTION = {
  none: 0,
  minor: 0.1,
  major: 0.3,
} as const;

/**
 * 좌표계 약속.
 *
 * y는 아래로 증가한다고 가정한다(이미지 좌표 관례). 그래서 "높이" = -y 다.
 * 판정 코어가 좌표계에 대해 아는 것은 이 한 줄뿐이다.
 *
 * MediaPipe worldLandmarks 의 y 부호는 **입력 계층이 실측해 맞춰 넣는다** —
 * `src/pose/landmarker.ts` 의 `detectYSign` 이 첫 검출에서 코와 발목의 y를
 * 비교해 정하고, 필요하면 부호를 뒤집어 판정 코어에 넘긴다. 부호를 추측해
 * 상수로 박지 않기 위해 그렇게 했고, 그래서 이 값은 모델이 바뀌어도 고칠 일이 없다.
 */
export const HEIGHT_SIGN = -1;

// ---------------------------------------------------------------------------
// 공통 — 판정 보류 (PRD 5절 H1~H5)
// ---------------------------------------------------------------------------

export const WITHHOLD = {
  /** H1. 필수 8점 중 하나라도 이 값 미만이면 그 프레임은 무효. */
  minVisibility: 0.5,

  /** H2. 무효 프레임 비율이 이 값을 넘으면 전체 보류. */
  maxInvalidRatio: 0.2,

  /**
   * H3. 인접 프레임 간격의 상한(ms). 두 가지를 동시에 정한다.
   *  - 이 값 이하의 결손은 선형 보간으로 메운다.
   *  - 이 값을 넘으면 메우지 않고 전체 보류한다.
   *
   * 일부러 상수 하나로 둔다. "메우는 한계"와 "보류하는 한계"를 따로 두면 그 사이에
   * 메우지도 보류하지도 않는 구간이 생기고, 거기서는 아무도 책임지지 않는다.
   * 빠진 구간에 동작의 어느 부분이 들어 있었는지 알 수 없으므로,
   * 판정 구간 안이든 밖이든 똑같이 보류한다(보수적으로).
   */
  maxFrameGapMs: 120,

  /** 결손으로 보고 메우기 시작하는 기준. 명목 간격의 1.5배를 넘으면 프레임이 빠진 것으로 본다. */
  gapDetectFactor: 1.5,

  /** H5. 항목 보류가 이 수 이상이면 전체 보류. */
  maxWithheldCriteria: 2,
} as const;

/**
 * H4. 측정값이 등급 경계에 이만큼 가까우면 그 항목만 보류한다.
 *
 * 검출 오차가 등급을 바꿀 수 있는 구간에서는 점수를 주지 않는다는 뜻이다.
 * 경계에서 점수를 주고 나중에 "오차 범위였다"고 말하는 것보다,
 * 처음부터 재지 않았다고 말하는 편이 반박 가능하다.
 */
export const EPSILON = {
  /** 각도 지표. PRD 5절 H4가 정한 값. */
  deg: 2,
  /** 비율 지표(S로 나눈 값). PRD 5절 H4가 정한 값. */
  ratio: 0.05,
  /**
   * 시간 지표. PRD에는 없고 이 구현이 더한 값이다.
   * 30fps에서 한 프레임이 33ms이므로, 프레임 하나 차이로 등급이 갈리지 않게 한다.
   */
  seconds: 0.03,
  /**
   * 문턱 자체가 아주 작은 지표(A5의 흔들림 0.03·S)에 절대 ε를 그대로 쓰면
   * 모든 입력이 보류가 된다. 그런 지표는 문턱 대비 상대 ε를 쓴다.
   */
  relative: 0.05,
} as const;

// ---------------------------------------------------------------------------
// 규칙 A — 주춤서기 (PRD 5절 규칙 A)
// ---------------------------------------------------------------------------

export const STANCE = {
  /**
   * A1 발 간격 = 좌우 발목의 수평거리 ÷ S.
   * 교습 자료의 "어깨 너비의 약 2배"를 중심으로 합격대를 1.70~2.30으로 잡았다.
   * 수평거리는 x만 쓴다 — z(깊이)를 넣으면 카메라 거리 오차가 그대로 들어온다.
   */
  feetGapBoundaries: [1.5, 1.7, 2.3, 2.6] as const,
  feetGapDeductions: [
    DEDUCTION.major, // < 1.50
    DEDUCTION.minor, // 1.50 ~ 1.70
    DEDUCTION.none, // 1.70 ~ 2.30  합격
    DEDUCTION.minor, // 2.30 ~ 2.60
    DEDUCTION.major, // > 2.60
  ] as const,

  /**
   * A2 무릎 굽힘 = 엉덩이–무릎–발목 내각. 좌우 각각 재고 나쁜 쪽을 쓴다.
   * "허벅지가 지면과 수평에 가깝게"를 각도로 옮기면 무릎 내각이 작아진다.
   * 145°를 합격선으로 둔 것은, 이보다 펴지면 눈으로도 "덜 앉았다"가 보이기 때문이다.
   */
  kneeAngleBoundaries: [145, 160] as const,
  kneeAngleDeductions: [DEDUCTION.none, DEDUCTION.minor, DEDUCTION.major] as const,

  /** A3 좌우 대칭 = 좌우 무릎 내각의 차. 체중이 한쪽으로 쏠리면 여기서 드러난다. */
  symmetryBoundaries: [8, 15] as const,
  symmetryDeductions: [DEDUCTION.none, DEDUCTION.minor, DEDUCTION.major] as const,

  /** A4 상체 수직 = (엉덩이 중점 → 어깨 중점) 벡터와 수직축이 이루는 각. */
  torsoTiltBoundaries: [10, 18] as const,
  torsoTiltDeductions: [DEDUCTION.none, DEDUCTION.minor, DEDUCTION.major] as const,

  /** A5 유지. 자세가 멈춘 구간이 이 시간 이상이어야 한다. */
  minHoldSeconds: 0.8,

  /**
   * A5 흔들림. 유지 구간에서 엉덩이 높이의 표준편차가 이 비율(×S) 이하여야 한다.
   *
   * 주의: worldLandmarks는 엉덩이 중점이 원점이라 엉덩이의 절대 높이는 항상 0이다.
   * 그래서 "엉덩이 높이"를 양 발목 평균 높이 대비 엉덩이 높이로 정의한다.
   * 원점이 무엇이든 같은 값이 나오고, 위아래로 까딱이는 것을 실제로 잡아낸다.
   */
  maxHipSwayRatio: 0.03,

  /** A5 미충족 시 감점. PRD 표의 "0.1 감점" 칸. */
  holdDeduction: DEDUCTION.minor,

  // --- 아래 셋은 "채점 경계"가 아니라 "구간 탐지" 상수다. ---
  // 채점값과 섞이면 순환이 생긴다(경계값이 구간을 정하고 구간이 경계값을 정하는).
  // 그래서 이름과 주석으로 갈라 둔다.

  /** 서 있는 것이 아니라 주춤서기를 하고 있다고 볼 무릎 내각 상한. */
  engagedKneeAngleMax: 160,
  /** 주춤서기라고 볼 최소 발 간격 비율. 차렷 자세를 구간에 넣지 않으려는 것. */
  engagedFeetGapMin: 1.2,
  /**
   * 자세가 "멈췄다"고 볼 엉덩이 상하 속도 상한 (m/s).
   * 앉는 도중의 프레임이 유지 구간에 섞이면 A5의 표준편차가 그 이동분까지 재게 된다.
   * 0.06 m/s는 0.8초 동안 5cm 미만으로 움직인다는 뜻이다.
   */
  settleSpeedMaxMps: 0.06,
  /**
   * 위 속도를 재기 전에 엉덩이 높이에 걸 이동평균 창(홀수 프레임).
   *
   * 검출기의 프레임 간 잡음이 5mm만 돼도 30fps에서 0.15 m/s처럼 보인다 —
   * 평활 없이 속도 문턱을 걸면 가만히 선 사람도 "멈추지 않았다"가 된다.
   * 평활은 구간을 찾는 데만 쓰고, A5가 재는 흔들림 자체에는 절대 걸지 않는다.
   * 흔들림을 재면서 흔들림을 깎아 내면 그 측정은 의미가 없다.
   */
  settleSmoothingWindow: 5,
} as const;

// ---------------------------------------------------------------------------
// 규칙 B — 앞차기 (PRD 5절 규칙 B)
// ---------------------------------------------------------------------------

export const FRONT_KICK = {
  /** S1 들기 판정: 무릎이 엉덩이 높이 이상이고 무릎 내각이 이 값 이하. */
  chamberKneeAngleMax: 100,
  /** S2 뻗기 판정: 무릎 내각이 이 값 이상(상태 기계용. 채점은 B4가 한다). */
  extendKneeAngleMin: 155,
  /** S3 회수 판정: 정점 이후 무릎 내각이 이 값 이하로 다시 접히는가. */
  retractKneeAngleMax: 110,

  /** B1 순서 위반(들기 없이 뻗기). */
  orderViolationDeduction: DEDUCTION.major,
  /** B2 회수 생략(뻗은 채로 착지). */
  noRetractDeduction: DEDUCTION.major,

  /**
   * B3 높이 = (발목 높이 − 엉덩이 높이) ÷ S, 정점 프레임에서.
   * 0 이상이면 합격. 0.10·S 이내로 모자라면 0.1, 그보다 모자라면 0.3.
   */
  kickHeightBoundaries: [-0.1, 0] as const,
  kickHeightDeductions: [DEDUCTION.major, DEDUCTION.minor, DEDUCTION.none] as const,

  /** B4 펴짐 = 정점 프레임의 무릎 내각. */
  extensionAngleBoundaries: [145, 155] as const,
  extensionAngleDeductions: [DEDUCTION.major, DEDUCTION.minor, DEDUCTION.none] as const,

  /** B5 상체 젖힘 = 정점 프레임에서 상체가 차는 방향의 반대로 기운 각. 앞으로 숙인 것은 0으로 본다. */
  torsoLeanBoundaries: [15, 25] as const,
  torsoLeanDeductions: [DEDUCTION.none, DEDUCTION.minor, DEDUCTION.major] as const,

  /** B6 축발 흔들림 = 동작 구간 중 축발 발목의 수평 이동폭 ÷ S. */
  supportDriftBoundaries: [0.25] as const,
  supportDriftDeductions: [DEDUCTION.none, DEDUCTION.minor] as const,

  /** B7 뻗기 지연 = 들기에서 정점까지 걸린 시간(초). */
  extendDelayBoundaries: [0.5] as const,
  extendDelayDeductions: [DEDUCTION.none, DEDUCTION.minor] as const,

  // --- 구간 탐지 상수 ---

  /**
   * 발이 이 높이(×S) 이상 올라간 구간만 "차기"로 본다.
   * 시작 자세의 발목 높이를 기준으로 잰다.
   */
  liftThresholdRatio: 0.15,
  /** 정점 이후 발목이 시작 높이 + 이 값(×S) 이하로 내려오면 착지로 본다. */
  landThresholdRatio: 0.1,
  /**
   * 정점을 고를 때 "다리가 뻗어 있다"고 볼 무릎각 허용 폭(도).
   *
   * 정점을 단순히 "발목이 가장 높은 프레임"으로 두면 낮게 찬 동작에서 틀린다 —
   * 무릎을 접어 회수하는 순간이 낮은 차기의 정점보다 높이 올라오기 때문이다.
   * 그래서 먼저 그 동작의 최대 무릎각을 구하고, 거기서 이 값 안쪽에 있는 프레임
   * (= 다리가 거의 다 뻗은 프레임)만 후보로 둔 뒤 그중 가장 높은 것을 정점으로 삼는다.
   * 채점 경계(B4의 145/155)가 아니라 구간 탐지 상수다.
   */
  apexExtensionToleranceDeg: 15,
  /**
   * 무릎각·발목 높이 시계열에 걸 이동평균 창(홀수 프레임).
   * 한 프레임의 튐이 정점 프레임이나 상태 전이를 바꾸지 못하게 한다.
   * A5의 흔들림에는 걸지 않는다 — 거기서는 흔들림 자체가 측정 대상이다.
   */
  smoothingWindow: 3,
} as const;

/** 측정하지 않기로 선언한 것. 빈칸으로 두지 않고 이유와 함께 화면에 낸다. */
export const NOT_MEASURED = {
  stance: [
    {
      id: "A-nm1",
      title: "발끝 방향",
      reason:
        "발끝·뒤꿈치 랜드마크는 정면에서 신뢰도가 낮다. 읽을 수 없는 것을 채점하지 않는다.",
    },
    {
      id: "A-nm2",
      title: "체중 배분 50:50",
      reason: "압력 센서 없이는 관측할 수 없다. 관절 좌표만으로는 추정도 근거가 없다.",
    },
  ],
  frontKick: [
    {
      id: "B-nm1",
      title: "타격 부위(앞축)",
      reason:
        "앞차기는 발가락을 젖혀 앞축으로 차야 하지만, 발가락 젖힘은 33개 랜드마크로 관측할 수 없다.",
    },
    {
      id: "B-nm2",
      title: "축발 뒤꿈치 회전",
      reason: "정면/측면 단일 카메라의 상대 깊이값으로는 축발 회전을 신뢰성 있게 읽을 수 없다.",
    },
  ],
} as const;
