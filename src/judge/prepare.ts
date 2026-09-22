/**
 * 판정 전에 시퀀스를 정리하는 층.
 *
 * 하는 일 세 가지.
 *  1. 구조 검사 — 33개 랜드마크인가, 시간이 단조 증가하는가.
 *  2. 신뢰도 게이트(H1) — 필수 8점 중 하나라도 흐리면 그 프레임을 무효로 표시한다.
 *  3. 결손 프레임 보간 — 120ms 이하로 빠진 구간은 선형 보간으로 메우고,
 *     그보다 크게 빠졌으면 메우지 않고 기록만 남긴다(H3은 judge.ts가 처리한다).
 *
 * 무효 프레임을 "지우지" 않고 표시만 하는 이유: 지우면 몇 번 프레임이 왜 빠졌는지
 * 화면에 적을 수 없다. 보류는 실패가 아니라 설명해야 하는 결과다(PRD 5절).
 */

import { ESSENTIAL_LANDMARKS, LANDMARK_COUNT, LANDMARK_NAMES_KO } from "./landmarks";
import { WITHHOLD } from "./constants";
import { lerpFrame } from "./math";
import { InvalidSequenceError, type LandmarkFrame, type LandmarkSequence } from "./types";

export interface PreparedFrame {
  timeMs: number;
  landmarks: LandmarkFrame;
  /** H1을 통과했는가. */
  valid: boolean;
  /** 결손을 메우려고 끼워 넣은 프레임인가. */
  interpolated: boolean;
  /** 원본 프레임 번호. 보간 프레임이면 바로 앞 원본 프레임의 번호. */
  sourceIndex: number;
}

export interface FrameGap {
  /** 이 원본 프레임 뒤에서 간격이 벌어졌다. */
  afterSourceIndex: number;
  gapMs: number;
  /** 보간으로 메웠는가. false면 H3 보류 대상이다. */
  filled: boolean;
}

export interface InvalidFrameNote {
  sourceIndex: number;
  /** 왜 무효인가 — 어느 관절이 얼마나 흐렸는지. */
  reason: string;
}

export interface PreparedSequence {
  frames: PreparedFrame[];
  /** 명목 프레임 간격(ms). fps에서 온다. */
  nominalDtMs: number;
  gaps: FrameGap[];
  invalidFrames: InvalidFrameNote[];
  sourceFrameCount: number;
  interpolatedCount: number;
}

/**
 * 한 프레임이 H1을 통과하는지 본다.
 * 통과 못 하면 어느 관절이 문제였는지 문장으로 돌려준다.
 */
export function checkVisibility(frame: LandmarkFrame): string | null {
  const bad: string[] = [];
  for (const idx of ESSENTIAL_LANDMARKS) {
    const v = frame[idx].visibility;
    if (v < WITHHOLD.minVisibility) {
      bad.push(`${LANDMARK_NAMES_KO[idx] ?? `랜드마크 ${idx}`} ${v.toFixed(2)}`);
    }
  }
  if (bad.length === 0) return null;
  return `신뢰도 ${WITHHOLD.minVisibility} 미만: ${bad.join(", ")}`;
}

export function prepareSequence(sequence: LandmarkSequence): PreparedSequence {
  const src = sequence.frames;

  if (src.length < 2) {
    throw new InvalidSequenceError(`프레임이 ${src.length}개다. 최소 2개가 필요하다.`);
  }
  for (let i = 0; i < src.length; i++) {
    if (src[i].landmarks.length !== LANDMARK_COUNT) {
      throw new InvalidSequenceError(
        `프레임 ${i}의 랜드마크가 ${src[i].landmarks.length}개다. ${LANDMARK_COUNT}개여야 한다.`,
      );
    }
    if (i > 0 && src[i].t <= src[i - 1].t) {
      throw new InvalidSequenceError(
        `시간이 단조 증가하지 않는다: 프레임 ${i - 1}=${src[i - 1].t}ms, ${i}=${src[i].t}ms.`,
      );
    }
  }
  if (!(sequence.fps > 0)) {
    throw new InvalidSequenceError(`fps가 ${sequence.fps}다. 0보다 커야 한다.`);
  }

  const nominalDtMs = 1000 / sequence.fps;
  const gapThresholdMs = nominalDtMs * WITHHOLD.gapDetectFactor;

  const frames: PreparedFrame[] = [];
  const gaps: FrameGap[] = [];
  const invalidFrames: InvalidFrameNote[] = [];
  let interpolatedCount = 0;

  for (let i = 0; i < src.length; i++) {
    const reason = checkVisibility(src[i].landmarks);
    if (reason !== null) invalidFrames.push({ sourceIndex: i, reason });

    frames.push({
      timeMs: src[i].t,
      landmarks: src[i].landmarks,
      valid: reason === null,
      interpolated: false,
      sourceIndex: i,
    });

    if (i === src.length - 1) break;

    const gapMs = src[i + 1].t - src[i].t;
    if (gapMs <= gapThresholdMs) continue;

    const fillable = gapMs <= WITHHOLD.maxFrameGapMs;
    gaps.push({ afterSourceIndex: i, gapMs, filled: fillable });
    if (!fillable) continue;

    // 명목 간격에 가깝게 프레임을 끼워 넣는다. 끝점은 이미 있으므로 사이만 채운다.
    const steps = Math.max(1, Math.round(gapMs / nominalDtMs));
    for (let k = 1; k < steps; k++) {
      const alpha = k / steps;
      const filledLandmarks = lerpFrame(src[i].landmarks, src[i + 1].landmarks, alpha);
      frames.push({
        timeMs: src[i].t + gapMs * alpha,
        landmarks: filledLandmarks,
        // 보간 프레임도 H1을 다시 통과해야 한다. lerpLandmark가 visibility를
        // 양 끝 중 낮은 쪽으로 가져가므로, 흐린 구간을 보간으로 세탁할 수 없다.
        valid: checkVisibility(filledLandmarks) === null,
        interpolated: true,
        sourceIndex: i,
      });
      interpolatedCount++;
    }
  }

  return {
    frames,
    nominalDtMs,
    gaps,
    invalidFrames,
    sourceFrameCount: src.length,
    interpolatedCount,
  };
}
