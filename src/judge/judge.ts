/**
 * 판정 진입점.
 *
 * 규칙 A·B가 항목별 감점을 내고, 이 파일이 보류 조건(H2·H3·H4·H5)을 얹어
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
