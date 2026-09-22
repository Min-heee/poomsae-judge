/**
 * 좋은 샘플을 일부러 망가뜨려 보류 경로를 시험하는 샘플을 만든다.
 *
 * PRD F5의 완료 기준이 "일부러 손상시킨 샘플(신뢰도 하향·프레임 삭제)이 보류로 떨어지고
 * 이유·프레임 번호가 표시된다"이다. 손상은 생성기를 다시 돌리지 않고 후처리 한 번으로 만든다 —
 * 그래야 "같은 동작인데 관측만 나빠졌다"는 것이 분명해진다.
 */

import type { LandmarkSequence, TimedFrame } from "../judge/types";

export interface OccludeOptions {
  id: string;
  label: string;
  /** 가릴 구간(프레임 번호, 양끝 포함). */
  from: number;
  to: number;
  /** 가릴 랜드마크 인덱스. */
  landmarks: readonly number[];
  /** 깎아 내릴 신뢰도. H1 문턱(0.5)보다 낮아야 무효 프레임이 된다. */
  visibility: number;
  origin: string;
  intent: string;
}

/** 특정 구간의 특정 관절 신뢰도를 깎는다. 좌표는 건드리지 않는다 — 가려서 못 본 것이지 움직인 것이 아니다. */
export function occlude(
  source: LandmarkSequence,
  opts: OccludeOptions,
): LandmarkSequence & { intent: string } {
  const targets = new Set(opts.landmarks);
  const frames: TimedFrame[] = source.frames.map((frame, i) => {
    if (i < opts.from || i > opts.to) return frame;
    return {
      t: frame.t,
      landmarks: frame.landmarks.map((p, idx) =>
        targets.has(idx) ? { ...p, visibility: opts.visibility } : p,
      ),
    };
  });
  return {
    ...source,
    id: opts.id,
    label: opts.label,
    origin: opts.origin,
    frames,
    intent: opts.intent,
  };
}

export interface DropOptions {
  id: string;
  label: string;
  /** 지울 구간(프레임 번호, 양끝 포함). */
  from: number;
  to: number;
  origin: string;
  intent: string;
}

/**
 * 프레임을 통째로 지운다. 남은 프레임의 타임스탬프는 그대로 두므로
 * 지운 자리에 시간 구멍이 생긴다 — 그것이 H3이 잡는 신호다.
 */
export function dropFrames(
  source: LandmarkSequence,
  opts: DropOptions,
): LandmarkSequence & { intent: string } {
  const frames = source.frames.filter((_, i) => i < opts.from || i > opts.to);
  return {
    ...source,
    id: opts.id,
    label: opts.label,
    origin: opts.origin,
    frames,
    intent: opts.intent,
  };
}
