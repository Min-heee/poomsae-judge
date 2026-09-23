/**
 * 게임의 판 구성 — 코스·라운드·단계 시간.
 *
 * 여기 있는 숫자는 전부 **놀이 층**이다. 판정 경계가 아니고 감점을 만들지 않는다.
 * 다만 근거는 판정 규칙에서 나온다 — 아래 `ROUND_LIMIT_SECONDS` 주석을 보라.
 */

import type { CameraView, MotionKind } from "../judge/types";
import type { ReferencePoseId } from "./types";

/**
 * 한 라운드의 단계별 시간(초).
 *
 * 준비 단계는 **기록하지 않는다.** 카운트다운 동안의 준비 자세가 기록기에 들어가면
 * 그 자세가 채점된다 — 게임이 피하려는 함정이 바로 그것이다(PRD-game 5.1).
 */
export const PHASE_SECONDS = {
  /** 교본 스켈레톤과 한 줄을 보여 준다. */
  present: 1.5,
  /** 3·2·1. 아직 기록하지 않는다. */
  ready: 3,
  /** 채택된 창을 되감아 재생 + 점수·감점. */
  feedback: 2,
} as const;

/**
 * 라운드별 맞추기 제한 시간(초). 0.5초씩 줄어드는 것이 이 게임의 난이도 곡선이다.
 *
 * **하한 4초는 규칙에서 나온다.** A5가 0.8초 유지를 요구하고, H7이 0.2초 이상 멈춘
 * 구간을 요구하며, 앉는 데 2초쯤 걸린다. 4초 미만은 난이도가 아니라 **불가능**이다.
 * 규칙을 건드리지 않고 만들 수 있는 곡선은 이것뿐이다.
 */
export const ROUND_LIMIT_SECONDS: readonly number[] = [6, 5.5, 5, 4.5, 4];

export const ROUNDS_PER_COURSE = ROUND_LIMIT_SECONDS.length;

export interface GameRound {
  /** 0부터. */
  index: number;
  poseId: ReferencePoseId;
  limitSeconds: number;
  /**
   * 시연 모드가 플레이어 입력 자리에 흘려보낼 **공개 샘플 id**.
   * 새 데이터를 만들지 않는다 — 이미 커밋된 결정적 샘플이 있다.
   * 점수가 오르내려야 콤보와 등급이 움직이는 것이 보이므로 합격/불합격을 섞는다.
   */
  demoSampleId: string;
}

export type CourseId = "frontal" | "sagittal";

export interface Course {
  id: CourseId;
  labelKo: string;
  /**
   * 이 코스가 전제하는 카메라 각도.
   *
   * **한 판에서 동작을 섞지 않는 이유가 이것이다(H6).** 섞으면 라운드마다 몸을 90°
   * 돌려야 하고, 안 돌리면 전부 보류다. 코스를 가르는 것이 규칙을 건드리지 않고
   * 이 문제를 푸는 유일한 방법이다.
   */
  view: CameraView;
  motion: MotionKind;
  poseId: ReferencePoseId;
  readonly rounds: readonly GameRound[];
}

function rounds(poseId: ReferencePoseId, demoSamples: readonly string[]): GameRound[] {
  if (demoSamples.length !== ROUNDS_PER_COURSE) {
    throw new Error(
      `${poseId}: 시연 샘플이 ${demoSamples.length}개다. 라운드 수 ${ROUNDS_PER_COURSE}와 같아야 한다.`,
    );
  }
  return ROUND_LIMIT_SECONDS.map((limitSeconds, index) => ({
    index,
    poseId,
    limitSeconds,
    demoSampleId: demoSamples[index],
  }));
}

export const COURSES: readonly Course[] = [
  {
    id: "frontal",
    labelKo: "정면 코스 — 주춤서기",
    view: "frontal",
    motion: "stance",
    poseId: "juchum",
    rounds: rounds("juchum", [
      "stance-good",
      "stance-narrow",
      "stance-good",
      "stance-narrow",
      "stance-good",
    ]),
  },
  {
    id: "sagittal",
    labelKo: "측면 코스 — 앞차기",
    view: "sagittal",
    motion: "frontKick",
    poseId: "ap-chagi-apex",
    rounds: rounds("ap-chagi-apex", [
      "frontkick-good",
      "frontkick-underextended",
      "frontkick-good",
      "frontkick-balance-broken",
      "frontkick-good",
    ]),
  },
];

export function course(id: CourseId): Course {
  const found = COURSES.find((c) => c.id === id);
  if (found === undefined) throw new Error(`코스 id 를 모른다: ${id}`);
  return found;
}

/** 한 판에 걸리는 시간(초). 화면이 "약 1분"이라고 적을 근거다. */
export function courseDurationSeconds(c: Course): number {
  const perRoundFixed = PHASE_SECONDS.present + PHASE_SECONDS.ready + PHASE_SECONDS.feedback;
  return c.rounds.reduce((sum, r) => sum + perRoundFixed + r.limitSeconds, 0);
}
