/**
 * 판정 코어가 주고받는 자료형.
 *
 * 입력은 "영상"이 아니라 "랜드마크 시퀀스"다(PRD 6절). 이 경계를 여기서 못 박는다.
 * 추론이 어디서 왔든(샘플 JSON이든 웹캠이든) 이 모양으로 들어오면 판정은 같아야 한다.
 */

/** 한 관절의 좌표. 단위는 미터, 원점은 엉덩이 중점(MediaPipe worldLandmarks 규약). */
export interface Landmark {
  x: number;
  y: number;
  z: number;
  /**
   * 검출기가 이 점을 얼마나 확신하는가. 0~1.
   * MediaPipe 타입에 presence 필드는 없다(문서 산문에만 있다) — visibility만 쓴다.
   */
  visibility: number;
}

/** 한 프레임 = 33개 랜드마크. */
export type LandmarkFrame = readonly Landmark[];

/** 시간이 붙은 한 프레임. t는 시퀀스 시작 기준 밀리초. */
export interface TimedFrame {
  t: number;
  landmarks: LandmarkFrame;
}

/** 채점 대상 동작. PRD 5절에서 두 가지만 고른 이유를 밝혔다. */
export type MotionKind = "stance" | "frontKick";

/**
 * 카메라가 어디서 봤다고 가정하는가.
 *
 * 규칙의 각도는 전부 화면 평면(x–y)에서 계산한다 — 단일 카메라의 z는 상대값이라
 * 깊이에 의존하는 판정을 만들지 않기로 했기 때문이다(PRD 8절).
 * 그래서 "어느 평면이 화면 평면인가"가 규칙의 전제가 된다.
 *   frontal  = 정면. 좌우 벌림이 x축에 나타난다. 주춤서기용.
 *   sagittal = 측면. 앞뒤 움직임이 x축에 나타난다. 앞차기용.
 */
export type CameraView = "frontal" | "sagittal";

export interface LandmarkSequence {
  /** 파일 이름과 같은 식별자. 골든 테스트가 이걸로 샘플을 찾는다. */
  id: string;
  /** 화면에 보일 한국어 이름. */
  label: string;
  motion: MotionKind;
  /**
   * 이 시퀀스가 **선언하는** 카메라 각도. 관측값이 아니라 선언이다.
   * 판정 코어는 이것을 읽어 규칙의 전제(`REQUIRED_VIEW`)와 대조하고,
   * 다르면 채점하지 않는다(H6). 선언이 없는 입력을 그럴듯하게 채점하는 것보다
   * 선언을 요구하고 어긋나면 멈추는 편이 반박 가능하다.
   */
  view: CameraView;
  /** 명목 프레임레이트. 결손 프레임 보간의 기준 간격을 여기서 얻는다. */
  fps: number;
  frames: readonly TimedFrame[];
  /** 이 시퀀스가 어떻게 만들어졌는지 한 줄. 화면과 저장소에 그대로 남는다. */
  origin?: string;
}

export type Grade =
  /** 감점 없음 */
  | "pass"
  /** 0.1 감점 */
  | "minor"
  /** 0.3 감점 */
  | "major"
  /** 경계에 너무 가깝거나 관측이 부족해 이 항목만 채점하지 않음 (H4) */
  | "withheld"
  /** 애초에 측정하지 않기로 선언한 항목 */
  | "unmeasured";

export type MeasureUnit = "deg" | "ratio" | "s" | "m" | "none";

/** 감점 한 줄. 점수만 주지 않고 "무엇을 재서 어디에 걸렸는지"를 같이 낸다(PRD F3). */
export interface CriterionResult {
  /** 'A1' 처럼 PRD 표의 항목 번호. */
  id: string;
  title: string;
  /** 무엇을 재는 규칙인지 한 줄. 앱의 규칙 표가 이 문자열을 그대로 쓴다. */
  rule: string;
  measured: number | null;
  unit: MeasureUnit;
  /** 등급이 갈리는 값들. 화면에 측정값과 나란히 보여 준다. */
  boundaries: readonly number[];
  grade: Grade;
  deduction: number;
  /** 사람이 읽는 근거 문장. */
  note: string;
  /** 이 값을 잰 원본 프레임 번호(보간 프레임이면 직전 원본 번호). */
  atFrame: number | null;
  atTimeMs: number | null;
  /** grade === 'withheld' 일 때만 채워진다. */
  withholdReason?: string;
}

/** 측정하지 않기로 선언한 것. 빈칸으로 두지 않고 이유와 함께 노출한다. */
export interface NotMeasured {
  id: string;
  title: string;
  reason: string;
}

export type WithholdCode = "H1" | "H2" | "H3" | "H4" | "H5" | "H6";

export interface WithholdNote {
  code: WithholdCode;
  message: string;
  /** 문제가 난 원본 프레임 번호들. 화면에 그대로 찍는다. */
  frames?: readonly number[];
}

export interface FrameStats {
  total: number;
  valid: number;
  invalid: number;
  invalidRatio: number;
  /** 120ms 이하 결손을 메우려고 끼워 넣은 프레임 수. */
  interpolated: number;
  /** 판정에 실제로 쓴 구간(원본 프레임 번호). 못 찾았으면 null. */
  judgedFrom: number | null;
  judgedTo: number | null;
  judgedDurationMs: number | null;
}

export interface Judgement {
  sequenceId: string;
  motion: MotionKind;
  /** 'withheld'면 score는 null이다. 0점과 보류는 다르다. */
  status: "judged" | "withheld";
  score: number | null;
  maxScore: number;
  totalDeduction: number;
  criteria: readonly CriterionResult[];
  notMeasured: readonly NotMeasured[];
  /**
   * 보류 사유와 관측 경고. H1은 "흐린 프레임이 있었다"는 경고라 총점을 막지 않고,
   * H2·H3·H5·H6이 있으면 전체 보류다. 실제 보류 여부는 status가 말한다.
   */
  withheld: readonly WithholdNote[];
  frameStats: FrameStats;
  /** 규칙표가 바뀌면 이 값이 바뀐다. 과거 판정과 섞이지 않게 하려는 표시. */
  rulesVersion: string;
}

/** 구조 자체가 잘못된 입력. 데이터 품질 문제(보류)와 구분한다. */
export class InvalidSequenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSequenceError";
  }
}
