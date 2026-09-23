/**
 * 게임 판정 — "시작 신호 이후 가장 잘 맞은 구간"을 고르고 점수를 낸다.
 *
 * 이 파일이 지키는 것 두 가지.
 *
 * **(1) 준비 자세가 채점될 경로가 없다.** 판정 창은 본질적으로 **과거**를 본다.
 * 카운트다운이 끝나는 순간을 스냅샷하면 '준비 자세'를 채점하게 된다. 그래서 게임은
 * 웹캠 훅의 링버퍼를 쓰지 않고 **시작 신호에서 연 기록기**의 프레임만 받는다.
 * 이 함수에 들어오는 `frames` 의 t = 0 이 곧 시작 신호이고, 그 앞의 프레임은 아예 없다.
 *
 * **(2) 판정 규칙을 한 글자도 바꾸지 않는다.** 창마다 기존 `judgeSequence` 를 그대로
 * 돌린다. 새 경계값도, 새 판정 함수도 만들지 않는다. 점수 산식은 **이미 나온 감점의
 * 재표현**일 뿐이다 — 최대 감점이 주춤서기 1.3 / 앞차기 1.7이라 원점수 범위가
 * 8.7~10.0이고, 그대로 쓰면 누구나 90점이라 변별이 안 되기 때문이다.
 */

import { judgeSequence } from "../judge";
import { FRONT_KICK, STANCE } from "../judge/constants";
import { InvalidSequenceError } from "../judge/types";
import type {
  CameraView,
  Judgement,
  LandmarkSequence,
  MotionKind,
  TimedFrame,
} from "../judge/types";

// ---------------------------------------------------------------------------
// 놀이 층 상수 — 전부 표현이고, 감점을 만들지 않는다
// ---------------------------------------------------------------------------

/**
 * 판정 창의 길이(ms).
 *
 * 2.0초는 A5의 유지 0.8초와 앞차기 한 번(약 1.2초)을 모두 담는다.
 * 정수 ms로 두는 것이 중요하다 — 초 단위 실수로 누적하면 창 경계가 기기마다 흔들린다.
 */
export const WINDOW_MS = 2000;

/** 창을 미는 보폭(ms). 6초 구간이면 후보가 21개다. */
export const WINDOW_STEP_MS = 200;

/** 이 기본점 이상이면 "성공" — 콤보가 이어진다. */
export const SUCCESS_BASE_SCORE = 70;

/** 콤보 배수의 상한에 닿는 연속 성공 수. 1 + 0.1 × 5 = 1.5 가 최대다. */
export const MAX_COMBO = 5;
export const COMBO_STEP = 0.1;

/** 남긴 1초당 속도 점수. */
export const SPEED_POINTS_PER_SECOND = 4;
export const MAX_SPEED_POINTS = 20;

/** 별 등급의 문턱. **총점이 아니라 기본점 평균**으로 매긴다. */
export const STAR_THRESHOLDS: readonly number[] = [60, 75, 90];

/**
 * 항목별 최대 감점. **상수를 다시 적지 않고 규칙표에서 끌어온다.**
 *
 * 분모가 되는 값이다. 여기에 숫자를 손으로 적으면 규칙표가 바뀌는 날 게임 점수만
 * 조용히 옛 척도로 남는다. 모르는 항목 id가 오면 던진다 — 규칙이 늘었는데 게임이
 * 모른 채 지나가는 것보다, 테스트가 그날 깨지는 편이 낫다.
 */
export const MAX_DEDUCTION_BY_CRITERION: Readonly<Record<string, number>> = {
  A1: Math.max(...STANCE.feetGapDeductions),
  A2: Math.max(...STANCE.kneeAngleDeductions),
  A3: Math.max(...STANCE.symmetryDeductions),
  A4: Math.max(...STANCE.torsoTiltDeductions),
  A5: STANCE.holdDeduction,
  B1: FRONT_KICK.orderViolationDeduction,
  B2: FRONT_KICK.noRetractDeduction,
  B3: Math.max(...FRONT_KICK.kickHeightDeductions),
  B4: Math.max(...FRONT_KICK.extensionAngleDeductions),
  B5: Math.max(...FRONT_KICK.torsoLeanDeductions),
  B6: Math.max(...FRONT_KICK.supportDriftDeductions),
  B7: Math.max(...FRONT_KICK.extendDelayDeductions),
};

export function maxDeductionFor(criterionId: string): number {
  const v = MAX_DEDUCTION_BY_CRITERION[criterionId];
  if (v === undefined) {
    throw new Error(
      `게임이 모르는 판정 항목이다: ${criterionId}. 규칙표가 늘었으면 ` +
        `MAX_DEDUCTION_BY_CRITERION 에도 최대 감점을 더해야 점수의 분모가 맞는다.`,
    );
  }
  return v;
}

/**
 * 판정 하나를 0~100 기본점으로.
 *
 * ```
 * 기본점 = round(100 × (1 − 총감점 ÷ 채점된 항목의 최대 감점 합))
 * ```
 *
 * 분모는 **그 창에서 실제로 채점된 항목**의 최대 감점 합이다. H4로 보류된 항목과
 * 애초에 재지 못한 항목(B7의 `unmeasured`)은 분자와 분모에서 **함께** 빠진다 —
 * 한쪽에서만 빼면 재지 않은 항목이 만점으로도 0점으로도 셈해진다.
 *
 * 보류된 판정에는 기본점이 없다(`null`). **0점과 보류는 다르다** — 이 프로젝트가
 * 판정 층에서 지켜 온 구분을 놀이 층에서 무너뜨리지 않는다.
 */
export function baseScoreOf(judgement: Judgement): number | null {
  if (judgement.status === "withheld") return null;
  let denominator = 0;
  let deduction = 0;
  for (const c of judgement.criteria) {
    if (c.grade === "withheld" || c.grade === "unmeasured") continue;
    denominator += maxDeductionFor(c.id);
    deduction += c.deduction;
  }
  if (denominator <= 0) return null;
  const ratio = 1 - deduction / denominator;
  return Math.round(100 * Math.min(1, Math.max(0, ratio)));
}

/** 콤보 배수. 1.0 ~ 1.5. */
export function comboMultiplier(streak: number): number {
  return 1 + COMBO_STEP * Math.min(Math.max(0, streak), MAX_COMBO);
}

/**
 * 속도 점수. 제한 시간에서 **채택한 창이 끝난 시각**을 뺀 만큼 준다.
 *
 * 판정 코어가 창 안에서 다시 고르는 구간(`judgedFrom/judgedTo`)이 아니라 창의 끝을
 * 쓴다 — 산식이 그렇게 정해졌고, 놀이 층이 판정 코어의 내부 선택에 기대면
 * 규칙이 바뀔 때 점수가 따라 흔들린다. 그 구간은 되감기와 카드에만 쓴다.
 */
export function speedPoints(limitSeconds: number, windowEndSeconds: number): number {
  const left = limitSeconds - windowEndSeconds;
  if (!Number.isFinite(left) || left <= 0) return 0;
  return Math.min(MAX_SPEED_POINTS, Math.floor(left * SPEED_POINTS_PER_SECOND));
}

// ---------------------------------------------------------------------------
// 라운드 판정
// ---------------------------------------------------------------------------

export interface RoundInput {
  /** 이 라운드가 채점할 동작. 기준 자세의 `judgedMotion` 이 그대로 온다. */
  motion: MotionKind;
  /** 시퀀스가 **선언하는** 카메라 각도. 코스가 정한다(H6). */
  view: CameraView;
  /** 맞추기 제한 시간(초). */
  limitSeconds: number;
  /**
   * 시작 신호 이후 기록된 프레임. **t = 0 이 시작 신호**이고 단조 증가해야 한다.
   * 준비 단계의 프레임은 여기 있으면 안 된다 — 있으면 준비 자세가 채점된다.
   */
  readonly frames: readonly TimedFrame[];
  fps: number;
  /** 이 라운드 직전까지의 연속 성공 수. */
  comboBefore: number;
  /** 판정에 넘길 시퀀스 id. 호출자가 준다(같은 입력 → 같은 출력). */
  sequenceId: string;
  label?: string;
}

export interface AdoptedWindow {
  /** 기록 기준 ms. */
  startMs: number;
  endMs: number;
  /** 기록 배열에서의 인덱스(양 끝 포함). 화면의 되감기가 이걸 쓴다. */
  fromIndex: number;
  toIndex: number;
  /**
   * 판정 코어가 이 창 **안에서** 다시 고른 구간(기록 기준 ms).
   *
   * 되감기와 결과 카드는 게임의 2초 창이 아니라 이 구간을 보여 줘야 한다 —
   * `findStanceWindow` 가 창 안에서 또 한 번 "멈춘 구간"을 고르기 때문이다.
   * 못 고른 경우(H7 등) null이다.
   */
  judgedFromMs: number | null;
  judgedToMs: number | null;
}

export interface RoundResult {
  sequenceId: string;
  motion: MotionKind;
  limitSeconds: number;
  status: "scored" | "withheld";
  /** 0~100. 보류면 null — 0점이 아니다. */
  baseScore: number | null;
  comboBefore: number;
  comboAfter: number;
  comboMultiplier: number;
  speedPoints: number;
  /** 라운드 점수. 보류면 0. */
  score: number;
  /** 기본점이 성공 문턱 이상인가. 콤보가 이어지는 조건이다. */
  success: boolean;
  /** 채택한 창. 후보가 하나도 서지 못했으면 null. */
  window: AdoptedWindow | null;
  /**
   * 채택한 창의 판정. 모든 창이 보류였으면 **첫 창의 판정**을 남긴다 —
   * 왜 보류인지 화면이 말할 수 있어야 하기 때문이다.
   */
  judgement: Judgement | null;
  candidateCount: number;
  allWithheld: boolean;
  /** 사람이 읽는 한 줄. */
  note: string;
}

interface Candidate {
  startMs: number;
  endMs: number;
  fromIndex: number;
  toIndex: number;
  judgement: Judgement;
  base: number | null;
}

function sliceIndices(
  frames: readonly TimedFrame[],
  fromMs: number,
  toMs: number,
): { from: number; to: number } | null {
  let from = -1;
  let to = -1;
  for (let i = 0; i < frames.length; i++) {
    const t = frames[i].t;
    if (t < fromMs) continue;
    if (t > toMs) break;
    if (from === -1) from = i;
    to = i;
  }
  if (from === -1 || to <= from) return null;
  return { from, to };
}

function assertRecording(frames: readonly TimedFrame[]): void {
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].t <= frames[i - 1].t) {
      throw new InvalidSequenceError(
        `기록의 시간이 단조 증가하지 않는다: ${i - 1}번 ${frames[i - 1].t}ms, ${i}번 ${frames[i].t}ms. ` +
          `기록기가 시작 신호 이후 프레임을 시간 순서대로 넣어야 한다.`,
      );
    }
  }
  if (frames.length > 0 && frames[0].t < 0) {
    throw new InvalidSequenceError(
      `기록의 첫 프레임이 ${frames[0].t}ms 다. t = 0 이 시작 신호이므로 음수가 있으면 ` +
        `준비 단계의 프레임이 섞인 것이다 — 그 자세가 채점된다.`,
    );
  }
}

/**
 * 시작 신호 이후의 기록에서 **가장 잘 맞은 창**을 골라 점수를 낸다.
 *
 * 구간을 통째로 채점하지 않는 이유: 자세로 들고 나는 전이 프레임이 중앙값을 끌어내린다.
 * 그래서 창 2.0초를 0.2초 보폭으로 밀며 창마다 기존 판정을 그대로 돌리고,
 * **기본점이 가장 높은 창**을 채택한다(동점이면 먼저 끝난 창).
 * **모든 창이 보류면 라운드도 보류다 — 점수를 지어내지 않는다.**
 */
export function judgeRound(input: RoundInput): RoundResult {
  const { frames, limitSeconds, motion, view, fps, comboBefore, sequenceId } = input;
  assertRecording(frames);

  const limitMs = Math.round(limitSeconds * 1000);
  const lastT = frames.length > 0 ? frames[frames.length - 1].t : 0;
  const sweepEndMs = Math.min(lastT, limitMs);

  const starts: number[] = [];
  for (let startMs = 0; startMs + WINDOW_MS <= sweepEndMs; startMs += WINDOW_STEP_MS) {
    starts.push(startMs);
  }
  // 기록이 창 하나보다 짧으면(제한 시간이 짧거나 카메라가 늦게 붙었으면)
  // 기록 전체를 창 하나로 본다. 후보가 0개라 "보류"가 되는 것은 자세 때문이 아니라
  // 구조 때문인데, 그 둘을 같은 말로 내면 사람이 무엇을 고쳐야 할지 알 수 없다.
  if (starts.length === 0) starts.push(0);

  const candidates: Candidate[] = [];
  for (const startMs of starts) {
    const endMs = Math.min(startMs + WINDOW_MS, sweepEndMs);
    const range = sliceIndices(frames, startMs, endMs);
    if (range === null) continue;
    const windowFrames = frames.slice(range.from, range.to + 1);
    const sequence: LandmarkSequence = {
      id: `${sequenceId}@${startMs}`,
      label: input.label ?? sequenceId,
      motion,
      view,
      fps,
      frames: windowFrames,
      origin: "따라하기 게임의 판정 창. 시작 신호 이후 기록에서 잘라 낸 구간이다.",
    };
    const judgement = judgeSequence(sequence);
    candidates.push({
      startMs,
      endMs: windowFrames[windowFrames.length - 1].t,
      fromIndex: range.from,
      toIndex: range.to,
      judgement,
      base: baseScoreOf(judgement),
    });
  }

  if (candidates.length === 0) {
    return withheldRound(
      input,
      null,
      null,
      0,
      false,
      "판정할 창을 하나도 세우지 못했다. 기록된 프레임이 창 하나를 채우지 못한다.",
    );
  }

  // 기본점이 가장 높은 창. 동점이면 **먼저 끝난 창** — starts 가 오름차순이므로
  // 엄격한 부등호로 비교하면 앞선 창이 그대로 남는다.
  let best: Candidate | null = null;
  for (const c of candidates) {
    if (c.base === null) continue;
    if (best === null || c.base > (best.base ?? -1)) best = c;
  }

  if (best === null) {
    const first = candidates[0];
    return withheldRound(
      input,
      first.judgement,
      windowOf(first, frames),
      candidates.length,
      true,
      `후보 창 ${candidates.length}개가 전부 보류다. 점수를 지어내지 않는다.`,
    );
  }

  const base = best.base as number;
  const success = base >= SUCCESS_BASE_SCORE;
  const comboAfter = success ? comboBefore + 1 : 0;
  const multiplier = comboMultiplier(comboAfter);
  const speed = speedPoints(limitSeconds, best.endMs / 1000);
  const score = Math.round(base * multiplier) + speed;

  return {
    sequenceId,
    motion,
    limitSeconds,
    status: "scored",
    baseScore: base,
    comboBefore,
    comboAfter,
    comboMultiplier: multiplier,
    speedPoints: speed,
    score,
    success,
    window: windowOf(best, frames),
    judgement: best.judgement,
    candidateCount: candidates.length,
    allWithheld: false,
    note:
      `후보 창 ${candidates.length}개 중 ${(best.startMs / 1000).toFixed(1)}~${(best.endMs / 1000).toFixed(1)}초 창을 채택했다. ` +
      `기본점 ${base} × 콤보 ${multiplier.toFixed(1)} + 속도 ${speed} = ${score}점.`,
  };
}

function windowOf(c: Candidate, frames: readonly TimedFrame[]): AdoptedWindow {
  const stats = c.judgement.frameStats;
  const at = (i: number | null): number | null => {
    if (i === null) return null;
    const abs = c.fromIndex + i;
    return abs >= 0 && abs < frames.length ? frames[abs].t : null;
  };
  return {
    startMs: c.startMs,
    endMs: c.endMs,
    fromIndex: c.fromIndex,
    toIndex: c.toIndex,
    judgedFromMs: at(stats.judgedFrom),
    judgedToMs: at(stats.judgedTo),
  };
}

function withheldRound(
  input: RoundInput,
  judgement: Judgement | null,
  window: AdoptedWindow | null,
  candidateCount: number,
  allWithheld: boolean,
  note: string,
): RoundResult {
  return {
    sequenceId: input.sequenceId,
    motion: input.motion,
    limitSeconds: input.limitSeconds,
    status: "withheld",
    baseScore: null,
    comboBefore: input.comboBefore,
    comboAfter: 0,
    comboMultiplier: comboMultiplier(0),
    speedPoints: 0,
    score: 0,
    success: false,
    window,
    judgement,
    candidateCount,
    allWithheld,
    note,
  };
}

// ---------------------------------------------------------------------------
// 한 판 정리
// ---------------------------------------------------------------------------

export interface CourseSummary {
  totalScore: number;
  /**
   * 기본점 평균. **보류 라운드는 0으로 센다.**
   *
   * 판정 층에서 "보류는 0점이 아니다"를 지켜 온 것과 어긋나 보이지만, 여기서 재는 것은
   * 판정이 아니라 **한 판의 성적**이다. 판정은 여전히 "보류"라고 말하고 있고
   * (`withheldRounds` 가 그 수를 들고 있다), 화면과 카드는 그 라운드를 0점이 아니라
   * 보류로 표시해야 한다. 이 평균은 별을 매기기 위한 놀이 층의 값이다.
   */
  averageBase: number;
  /** 0~3. */
  stars: number;
  /** 가장 잘한 라운드. 결과 카드의 스켈레톤이 이 라운드에서 나온다. */
  bestRoundIndex: number | null;
  withheldRounds: number;
  /** 한 판에서 이어 간 최장 콤보. */
  bestCombo: number;
}

export function starsFor(averageBase: number): number {
  let stars = 0;
  for (const t of STAR_THRESHOLDS) if (averageBase >= t) stars++;
  return stars;
}

export function summarizeCourse(rounds: readonly RoundResult[]): CourseSummary {
  if (rounds.length === 0) {
    return {
      totalScore: 0,
      averageBase: 0,
      stars: 0,
      bestRoundIndex: null,
      withheldRounds: 0,
      bestCombo: 0,
    };
  }
  let total = 0;
  let baseSum = 0;
  let withheldRounds = 0;
  let bestCombo = 0;
  let bestRoundIndex: number | null = null;
  let bestBase = -1;

  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    total += r.score;
    baseSum += r.baseScore ?? 0;
    if (r.status === "withheld") withheldRounds++;
    bestCombo = Math.max(bestCombo, r.comboAfter);
    if (r.baseScore !== null && r.baseScore > bestBase) {
      bestBase = r.baseScore;
      bestRoundIndex = i;
    }
  }

  const averageBase = baseSum / rounds.length;
  return {
    totalScore: total,
    averageBase,
    stars: starsFor(averageBase),
    bestRoundIndex,
    withheldRounds,
    bestCombo,
  };
}

// ---------------------------------------------------------------------------
// 기록기 — 시연 모드가 공개 샘플을 플레이어 입력 자리에 흘려보낼 때 쓴다
// ---------------------------------------------------------------------------

/**
 * 시퀀스의 한 토막을 **시작 신호 기준 기록**으로 바꾼다.
 *
 * 시연 모드는 웹캠 자리에 합성 샘플을 흘려보낼 뿐, 루프·판정·오버레이·카드는
 * 웹캠 모드와 **완전히 같은 코드**를 지난다. 그 "흘려보내기"가 이 함수다 —
 * t를 시작 신호 기준으로 다시 세고, 제한 시간 밖의 프레임을 버린다.
 */
export function takeRecording(
  frames: readonly TimedFrame[],
  startMs: number,
  limitSeconds: number,
): TimedFrame[] {
  const limitMs = Math.round(limitSeconds * 1000);
  const out: TimedFrame[] = [];
  for (const f of frames) {
    const t = f.t - startMs;
    if (t < 0) continue;
    if (t > limitMs) break;
    out.push({ t: Math.round(t * 10) / 10, landmarks: f.landmarks });
  }
  return out;
}
