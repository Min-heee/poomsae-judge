/**
 * 샘플 전체를 굽는 한 곳.
 *
 * 화면과 테스트가 같은 함수를 부른다. "public/samples/*.json 이 어디서 왔는가"에
 * 이 파일 하나로 답할 수 있어야 한다.
 */

import { LM } from "../judge/landmarks";
import type { LandmarkSequence } from "../judge/types";
import { dropFrames, occlude } from "./degrade";
import { buildSequence, SAMPLE_SPECS } from "./motion";

export interface BuiltSample {
  sequence: LandmarkSequence;
  /** 이 샘플이 어떤 판정을 받도록 만들어졌는가. 테스트가 확인하는 문장. */
  intent: string;
}

/**
 * 손상 샘플은 'frontkick-good'에서 파생시킨다.
 * 같은 동작인데 관측만 나빠졌다는 것을 보이려는 것이다.
 */
function derive(good: LandmarkSequence): BuiltSample[] {
  const occluded = occlude(good, {
    id: "frontkick-occluded",
    label: "앞차기 — 관절이 가려짐",
    // 정점 앞뒤를 덮는다. 하필 제일 중요한 구간이 안 보이는 상황이다.
    from: 12,
    to: 36,
    landmarks: [LM.rightKnee, LM.rightAnkle],
    visibility: 0.3,
    origin:
      "frontkick-good 에서 오른쪽 무릎·발목의 신뢰도만 0.30으로 깎은 파생 샘플. 좌표는 그대로다.",
    intent: "H1로 무효 프레임이 생기고 그 비율이 20%를 넘어 H2 전체 보류.",
  });

  const dropped = dropFrames(good, {
    id: "frontkick-dropped-frames",
    label: "앞차기 — 프레임이 끊김",
    from: 20,
    to: 25,
    origin:
      "frontkick-good 에서 프레임 20~25를 지운 파생 샘플. 남은 프레임의 타임스탬프는 그대로라 그 자리에 시간 구멍이 남는다.",
    intent: "인접 프레임 간격이 120ms를 넘어 H3 전체 보류.",
  });

  return [
    { sequence: occluded, intent: occluded.intent },
    { sequence: dropped, intent: dropped.intent },
  ];
}

export function buildAllSamples(): BuiltSample[] {
  const base = SAMPLE_SPECS.map((spec) => ({
    sequence: buildSequence(spec),
    intent: spec.intent,
  }));
  const good = base.find((s) => s.sequence.id === "frontkick-good");
  if (good === undefined) throw new Error("frontkick-good 이 없다. 파생 샘플을 만들 수 없다.");
  return [...base, ...derive(good.sequence)];
}

export interface SampleManifestEntry {
  id: string;
  label: string;
  motion: string;
  view: string;
  fps: number;
  frameCount: number;
  file: string;
  intent: string;
}

export function buildManifest(samples: readonly BuiltSample[]): {
  schemaVersion: number;
  generatedBy: string;
  note: string;
  samples: SampleManifestEntry[];
} {
  return {
    schemaVersion: 1,
    generatedBy: "src/samples/write-samples.ts",
    note: "합성 시퀀스다. 촬영본이 아니며, 규칙이 옳다는 증명이 아니라 규칙이 의도대로 동작하는지를 보이는 회귀용 데이터다.",
    samples: samples.map((s) => ({
      id: s.sequence.id,
      label: s.sequence.label,
      motion: s.sequence.motion,
      view: s.sequence.view,
      fps: s.sequence.fps,
      frameCount: s.sequence.frames.length,
      file: `${s.sequence.id}.json`,
      intent: s.intent,
    })),
  };
}
