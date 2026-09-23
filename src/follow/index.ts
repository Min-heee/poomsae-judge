/**
 * 비교 코어의 공개 면.
 *
 * 이 폴더는 **순수 함수만** 둔다 — DOM·카메라·네트워크·`Date.now()`·`Math.random()` 을
 * 쓰지 않는다. 입력은 랜드마크와 시각, 출력은 차이와 점수이며, 같은 입력이면 항상 같은
 * 출력이다(`src/judge` 가 지켜 온 약속과 같다).
 *
 * 그리고 한 방향으로만 기댄다: **비교 층은 `src/judge` 를 읽기만 한다.**
 * 감점 상수를 고치지도, 새 판정 함수를 만들지도 않는다. 이 층을 통째로 지워도
 * 판정은 어제와 같은 점수를 낸다.
 */

export {
  REFERENCE_POSES,
  referencePose,
  referencePoseVariant,
  isJudged,
} from "./reference";

export {
  compareToReference,
  chooseOrientation,
  SIDE_LABEL_KO,
  type CompareOptions,
  type OrientationChoice,
} from "./compare";

export { normalize, mirrorFrame, MIRROR_INDEX, MIRROR_PAIRS } from "./frame";

export {
  ANGLE_BAND,
  ARM_ANGLE_BAND,
  FEET_GAP_BAND,
  KNEE_SPREAD_BAND,
  LENGTH_BAND,
  MOMTONG_ELBOW_BAND,
  OFF_ZERO_MULTIPLE,
  SCORE_AT_WARN,
  SCORE_OK,
  bandOf,
  itemScore,
  type Band,
} from "./bands";

export { METRIC_SPECS, FRAME_ANCHORS, weightSum, sideLabel } from "./metrics";

export {
  MAX_DEDUCTION_BY_CRITERION,
  MAX_COMBO,
  MAX_SPEED_POINTS,
  SPEED_POINTS_PER_SECOND,
  STAR_THRESHOLDS,
  SUCCESS_BASE_SCORE,
  WINDOW_MS,
  WINDOW_STEP_MS,
  baseScoreOf,
  comboMultiplier,
  judgeRound,
  maxDeductionFor,
  speedPoints,
  starsFor,
  summarizeCourse,
  takeRecording,
  type AdoptedWindow,
  type CourseSummary,
  type RoundInput,
  type RoundResult,
} from "./game";

export {
  COURSES,
  PHASE_SECONDS,
  ROUNDS_PER_COURSE,
  ROUND_LIMIT_SECONDS,
  course,
  courseDurationSeconds,
  type Course,
  type CourseId,
  type GameRound,
} from "./courses";

export type {
  BodySide,
  Comparison,
  MatchBand,
  MetricComparison,
  MetricSpec,
  MetricUnit,
  NormalizedFrame,
  ReferenceMetric,
  ReferencePose,
  ReferencePoseId,
} from "./types";

export {
  REFERENCE_POSE_IDS,
  REFERENCE_RIGS,
  buildReferenceFrame,
  buildReferenceFrameWith,
  referenceDemoFrames,
  solveElbow3,
  type DemoSequence,
  type ReferenceRig,
} from "../samples/reference-frames";
