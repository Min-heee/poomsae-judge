/**
 * 판정 진입점.
 *
 * 규칙 A·B가 항목별 감점을 내고, 이 파일이 보류 조건(H1~H7)을 얹어
 * 최종 점수 또는 "판정 보류"를 만든다.
 *
 * 보류는 실패가 아니다. 0점과 보류는 다른 결과이고, 그래서 score는 number | null 이다.
 */

import {
  MAX_SCORE,
  MOTION_LABEL_KO,
  NOT_MEASURED,
  REQUIRED_VIEW,
  RULES_VERSION,
  STANCE,
  VIEW_LABEL_KO,
  WITHHOLD,
} from "./constants";
import { judgeFrontKick } from "./frontKick";
import { round } from "./math";
import { prepareSequence, type PreparedSequence } from "./prepare";
import { judgeStance } from "./stance";
import type {
  CriterionResult,
  FrameStats,
  Judgement,
  LandmarkSequence,
  NotMeasured,
  WithholdNote,
} from "./types";

/** 프레임 번호 목록을 "40~58, 61" 처럼 접어 준다. 화면에 그대로 찍는다. */
export function formatFrameRanges(indices: readonly number[]): string {
  if (indices.length === 0) return "";
  const sorted = [...indices].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = i < sorted.length ? sorted[i] : Number.NaN;
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}~${prev}`);
    start = cur;
    prev = cur;
  }
  return parts.join(", ");
}

function buildFrameStats(
  prepared: PreparedSequence,
  judgedFrom: number | null,
  judgedTo: number | null,
  judgedDurationMs: number | null,
): FrameStats {
  const invalid = prepared.invalidFrames.length;
  return {
    total: prepared.sourceFrameCount,
    valid: prepared.sourceFrameCount - invalid,
    invalid,
    invalidRatio: round(invalid / prepared.sourceFrameCount, 4),
    interpolated: prepared.interpolatedCount,
    judgedFrom,
    judgedTo,
    judgedDurationMs: judgedDurationMs === null ? null : round(judgedDurationMs, 1),
  };
}

function notMeasuredFor(motion: LandmarkSequence["motion"]): NotMeasured[] {
  return [...NOT_MEASURED[motion]];
}

/**
 * 감점 합계 → 최종 점수.
 *
 * 하한 0을 여기서 묶는다. 지금 규칙표의 최대 감점은 앞차기 1.7 / 주춤서기 1.3이라
 * 이 하한이 실제로 걸리는 일은 없다 — 항목이 늘어 감점 합이 10을 넘기는 날을 위한
 * 보장이고, 그래서 규칙표가 아니라 이 함수의 테스트가 지킨다.
 */
export function finalScore(totalDeduction: number): number {
  return round(Math.max(0, MAX_SCORE - totalDeduction), 1);
}

export function judgeSequence(sequence: LandmarkSequence): Judgement {
  const prepared = prepareSequence(sequence);
  const withheld: WithholdNote[] = [];

  // --- H1 / H2 : 흐린 프레임 -------------------------------------------------
  const invalidIndices = prepared.invalidFrames.map((f) => f.sourceIndex);
  const invalidRatio = invalidIndices.length / prepared.sourceFrameCount;

  if (invalidIndices.length > 0) {
    // 비율이 문턱을 넘지 않아도 어느 프레임이 왜 흐렸는지는 남긴다.
    // 수련생이 "다시 찍어야 하나"를 판단할 근거가 이것이다(PRD 3절 사용자 C).
    const first = prepared.invalidFrames[0];
    withheld.push({
      code: "H1",
      message: `필수 관절이 흐린 프레임 ${invalidIndices.length}개 (프레임 ${formatFrameRanges(invalidIndices)}). 예: 프레임 ${first.sourceIndex} — ${first.reason}`,
      frames: invalidIndices,
    });
  }

  const overInvalidRatio = invalidRatio > WITHHOLD.maxInvalidRatio;
  if (overInvalidRatio) {
    withheld.push({
      code: "H2",
      message: `무효 프레임이 ${(invalidRatio * 100).toFixed(1)}%다. 기준은 ${WITHHOLD.maxInvalidRatio * 100}%다. 이 입력으로는 채점하지 않는다.`,
      frames: invalidIndices,
    });
  }

  // --- H3 : 끊긴 프레임 ------------------------------------------------------
  const unfilledGaps = prepared.gaps.filter((g) => !g.filled);
  if (unfilledGaps.length > 0) {
    withheld.push({
      code: "H3",
      message: unfilledGaps
        .map(
          (g) =>
            `프레임 ${g.afterSourceIndex}와 ${g.afterSourceIndex + 1} 사이가 ${Math.round(g.gapMs)}ms 비었다(기준 ${WITHHOLD.maxFrameGapMs}ms). 그 사이에 동작의 어느 부분이 있었는지 알 수 없다.`,
        )
        .join(" "),
      frames: unfilledGaps.map((g) => g.afterSourceIndex),
    });
  }

  // --- H6 : 카메라 각도 전제 --------------------------------------------------
  // 규칙 A는 정면, 규칙 B는 측면을 전제한다(constants.ts REQUIRED_VIEW).
  // 각도는 관측할 수 없으므로 시퀀스의 선언을 믿는다. 선언이 전제와 다르면
  // 다른 평면에서 잰 각도·비율로 채점하게 되므로, 아예 채점하지 않는다.
  const requiredView = REQUIRED_VIEW[sequence.motion];
  const viewMismatch = sequence.view !== requiredView;
  if (viewMismatch) {
    withheld.push({
      code: "H6",
      message:
        `이 시퀀스는 카메라 각도를 '${VIEW_LABEL_KO[sequence.view]}'으로 선언했는데, ` +
        `${MOTION_LABEL_KO[sequence.motion]} 규칙은 '${VIEW_LABEL_KO[requiredView]}' 촬영을 전제한다. ` +
        `규칙의 각도와 비율은 전부 화면 평면에서 재므로, 전제가 다르면 같은 자세도 다른 값이 된다. 채점하지 않는다.`,
    });
  }

  // --- 규칙 A / B ------------------------------------------------------------
  let criteria: CriterionResult[] = [];
  let judgedFrom: number | null = null;
  let judgedTo: number | null = null;
  let judgedDurationMs: number | null = null;
  let stanceNotSettled = false;

  if (sequence.motion === "stance") {
    const outcome = judgeStance(prepared);
    if (outcome === null) {
      // 이미 H2로 "흐려서 못 본다"고 말했으면 같은 사실을 두 번 적지 않는다.
      if (!overInvalidRatio) {
        withheld.push({
          code: "H2",
          message: "주춤서기로 볼 구간을 찾지 못했다. 유효한 프레임이 이어지지 않는다.",
        });
      }
    } else {
      criteria = outcome.criteria;
      judgedFrom = prepared.frames[outcome.window.start].sourceIndex;
      judgedTo = prepared.frames[outcome.window.end].sourceIndex;
      judgedDurationMs = outcome.window.durationSeconds * 1000;

      // --- H7 : 주춤서기로 볼 멈춘 구간이 없다 --------------------------------
      // window.settled 가 false면 구간 탐지가 "유효 프레임이 이어지는 가장 긴 구간"으로
      // 물러섰다는 뜻이다(stance.ts findStanceWindow). 즉 주춤서기라고 볼 프레임이
      // 하나도 없었다. 그런데 A3(좌우 대칭)·A4(상체 수직)는 가만히 서 있기만 해도
      // 통과하므로, 그대로 두면 차렷 자세가 감점 몇 개만 붙은 '판정 완료'로 나온다.
      // **나쁜 자세와 자세 아님은 다른 결과다.** 후자에는 점수를 만들지 않는다.
      //
      // 문턱은 가장 좁게 잡았다 — 주춤서기로 볼 프레임이 하나라도 있으면 채점하고,
      // 그 구간이 짧다는 사실은 A5가 감점으로 말한다. 여기서 길이까지 요구하면
      // A5가 이미 하는 말을 보류가 다시 하게 된다.
      if (!outcome.window.settled) {
        stanceNotSettled = true;
        withheld.push({
          code: "H7",
          message:
            `주춤서기로 볼 멈춘 구간이 없다. 양쪽 무릎이 ${STANCE.engagedKneeAngleMax}° 이하로 굽고, ` +
            `발 간격이 어깨 너비의 ${STANCE.engagedFeetGapMin}배 이상이며, 엉덩이가 ` +
            `${STANCE.settleSpeedMaxMps}m/s 이하로 멈춰 있는 프레임이 하나도 없었다. ` +
            `그냥 서 있는 것과 주춤서기를 가를 수 없으므로 채점하지 않는다. ` +
            `무릎을 굽혀 발을 벌린 자세로 ${STANCE.minHoldSeconds}초 이상 멈춘 뒤 다시 재면 채점한다.`,
        });
      }
    }
  } else {
    const outcome = judgeFrontKick(prepared);
    if (outcome === null) {
      if (!overInvalidRatio) {
        withheld.push({
          code: "H2",
          message: "발이 올라간 구간을 찾지 못했다. 앞차기로 볼 동작이 없다.",
        });
      }
    } else {
      criteria = outcome.criteria;
      judgedFrom = prepared.frames[outcome.phases.windowStart].sourceIndex;
      judgedTo = prepared.frames[outcome.phases.windowEnd].sourceIndex;
      judgedDurationMs =
        prepared.frames[outcome.phases.windowEnd].timeMs -
        prepared.frames[outcome.phases.windowStart].timeMs;
    }
  }

  // --- H4 : 경계에 붙은 항목 -------------------------------------------------
  const withheldItems = criteria.filter((c) => c.grade === "withheld");
  for (const item of withheldItems) {
    withheld.push({
      code: "H4",
      message: `${item.id} ${item.title} — ${item.withholdReason ?? "경계 근접으로 보류."}`,
      frames: item.atFrame === null ? undefined : [item.atFrame],
    });
  }

  // --- H5 : 보류 항목이 많으면 전체 보류 -------------------------------------
  const tooManyWithheld = withheldItems.length >= WITHHOLD.maxWithheldCriteria;
  if (tooManyWithheld) {
    withheld.push({
      code: "H5",
      message: `보류된 항목이 ${withheldItems.length}개다(${withheldItems.map((c) => c.id).join(", ")}). 기준은 ${WITHHOLD.maxWithheldCriteria}개이며, 이만큼 빠지면 남은 항목만으로 총점을 말할 수 없다.`,
    });
  }

  const sequenceWithheld =
    stanceNotSettled ||
    viewMismatch ||
    overInvalidRatio ||
    unfilledGaps.length > 0 ||
    tooManyWithheld ||
    criteria.length === 0;

  const totalDeduction = criteria.reduce((sum, c) => sum + c.deduction, 0);
  const score = sequenceWithheld ? null : finalScore(totalDeduction);

  return {
    sequenceId: sequence.id,
    motion: sequence.motion,
    status: sequenceWithheld ? "withheld" : "judged",
    score,
    maxScore: MAX_SCORE,
    totalDeduction: round(totalDeduction, 1),
    criteria,
    notMeasured: notMeasuredFor(sequence.motion),
    withheld,
    frameStats: buildFrameStats(prepared, judgedFrom, judgedTo, judgedDurationMs),
    rulesVersion: RULES_VERSION,
  };
}
