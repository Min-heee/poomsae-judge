/**
 * 카드 시험용 입력. `src/samples/fixtures.ts` 와 같은 자리에 있는 물건이다 —
 * 테스트가 읽고, 앱 번들에는 들어가지 않는다.
 *
 * 좌표는 **정규화 이미지 좌표(0~1)** 다. 판정에는 쓰이지 않는다.
 */

import { LM } from "@/judge/landmarks";
import type { CriterionResult } from "@/judge/types";
import type { CardInput, CardPoint } from "./types";

export interface PoseOptions {
  /** 얼굴 랜드마크(0~10)를 놓을 자리. 카드에 아무 영향이 없어야 한다. */
  face?: CardPoint;
  /** 발 간격을 벌리거나 좁힌다(자세가 달라 보이게). */
  spread?: number;
  /** 전체를 위아래로 민다. */
  shiftY?: number;
}

/** 정면에서 본 주춤서기 비슷한 서 있는 자세 33점. */
export function standPose(opts: PoseOptions = {}): CardPoint[] {
  const face = opts.face ?? { x: 0.5, y: 0.17 };
  const s = opts.spread ?? 1;
  const dy = opts.shiftY ?? 0;
  const p = (x: number, y: number): CardPoint => ({ x, y: y + dy });

  const out: CardPoint[] = new Array(33).fill(null).map(() => ({ ...face }));

  out[LM.leftShoulder] = p(0.565, 0.3);
  out[LM.rightShoulder] = p(0.435, 0.3);
  out[LM.leftElbow] = p(0.6, 0.42);
  out[LM.rightElbow] = p(0.4, 0.42);
  out[LM.leftWrist] = p(0.565, 0.51);
  out[LM.rightWrist] = p(0.435, 0.51);
  out[LM.leftPinky] = p(0.57, 0.545);
  out[LM.rightPinky] = p(0.43, 0.545);
  out[LM.leftIndex] = p(0.558, 0.548);
  out[LM.rightIndex] = p(0.442, 0.548);
  out[LM.leftThumb] = p(0.552, 0.535);
  out[LM.rightThumb] = p(0.448, 0.535);
  out[LM.leftHip] = p(0.545, 0.52);
  out[LM.rightHip] = p(0.455, 0.52);
  out[LM.leftKnee] = p(0.5 + 0.1 * s, 0.7);
  out[LM.rightKnee] = p(0.5 - 0.1 * s, 0.7);
  out[LM.leftAnkle] = p(0.5 + 0.14 * s, 0.88);
  out[LM.rightAnkle] = p(0.5 - 0.14 * s, 0.88);
  out[LM.leftHeel] = p(0.5 + 0.145 * s, 0.9);
  out[LM.rightHeel] = p(0.5 - 0.145 * s, 0.9);
  out[LM.leftFootIndex] = p(0.5 + 0.175 * s, 0.92);
  out[LM.rightFootIndex] = p(0.5 - 0.175 * s, 0.92);

  return out;
}

export function criterion(over: Partial<CriterionResult> = {}): CriterionResult {
  return {
    id: "A1",
    title: "발 간격",
    rule: "좌우 발목의 수평거리 ÷ 어깨 너비",
    measured: 1.48,
    unit: "ratio",
    boundaries: [1.5, 1.7, 2.3, 2.6],
    grade: "major",
    deduction: 0.3,
    note: "측정값 1.48·S — 합격대보다 좁다.",
    atFrame: 21,
    atTimeMs: 700,
    ...over,
  };
}

/** 카드 한 장을 채우는 표준 입력. */
export function cardInput(over: Partial<CardInput> = {}): CardInput {
  return {
    courseLabel: "정면 코스 · 주춤서기",
    motion: "stance",
    totalScore: 812,
    averageBase: 86,
    stars: 2,
    rounds: [
      { baseScore: 92, total: 178 },
      { baseScore: 77, total: 96 },
      { baseScore: null, total: 0 },
      { baseScore: 88, total: 112 },
      { baseScore: 86, total: 106 },
    ],
    best: {
      roundNumber: 1,
      rawScore: 9.7,
      maxScore: 10,
      criteria: [
        criterion(),
        criterion({
          id: "A4",
          title: "상체 수직",
          measured: 9.4,
          unit: "deg",
          boundaries: [8, 15],
          grade: "minor",
          deduction: 0.1,
          note: "측정값 9.4° — 조금 기울었다.",
        }),
        criterion({
          id: "A2",
          title: "무릎 굽힘",
          measured: 138.2,
          unit: "deg",
          boundaries: [125, 145],
          grade: "pass",
          deduction: 0,
          note: "합격.",
        }),
      ],
      skeleton: {
        mine: standPose(),
        reference: standPose({ spread: 1.15 }),
        aspect: 4 / 3,
      },
    },
    dateISO: "2026-09-24",
    rulesVersion: "A/B-1.1.0",
    originLabel: "합성 샘플 파일",
    ...over,
  };
}
