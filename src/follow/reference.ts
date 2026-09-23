/**
 * 기준 자세(교본) — 프레임과 목표값을 한곳에.
 *
 * 목표값은 **기준 프레임에서 잰다.** `docs/reference-poses.md` 5절의 표에 적힌 숫자를
 * 코드에 다시 쓰지 않는다 — 두 곳에 같은 숫자가 있으면 한쪽만 고쳐지는 날이 온다.
 * 대신 테스트가 이 계산 결과를 그 표와 대조한다(±0.5° / ±0.02).
 * 문서와 코드가 어긋나면 테스트가 깨지게 두는 편이 낫다.
 */

import { STANCE } from "../judge/constants";
import { LEFT_LEG, RIGHT_LEG } from "../judge/landmarks";
import type { Landmark } from "../judge/types";
import { kneeAngle } from "../judge/coords";
import {
  buildReferenceFrame,
  buildReferenceFrameWith,
  REFERENCE_RIGS,
} from "../samples/reference-frames";
import type { KickParams, StanceParams } from "../samples/rig";
import { assertBand } from "./bands";
import { normalize } from "./frame";
import { METRIC_SPECS, weightSum } from "./metrics";
import type { ReferenceMetric, ReferencePose, ReferencePoseId } from "./types";

function buildPose(id: ReferencePoseId, frameOverride?: readonly Landmark[]): ReferencePose {
  const rig = REFERENCE_RIGS.find((r) => r.id === id);
  if (rig === undefined) throw new Error(`기준 자세 id 를 모른다: ${id}`);

  const frame = frameOverride ?? buildReferenceFrame(id);
  const normalized = normalize(frame);
  if (normalized === null) {
    throw new Error(`기준 자세 ${id} 의 어깨 너비를 구할 수 없다. 생성기가 잘못됐다.`);
  }

  const specs = METRIC_SPECS[id];
  const sum = weightSum(specs);
  if (Math.abs(sum - 100) > 1e-9) {
    throw new Error(`${id} 의 가중치 합이 ${sum} 이다. 100이어야 한다.`);
  }

  const metrics: ReferenceMetric[] = specs.map((s) => {
    assertBand({ ok: s.ok, warn: s.warn }, `${id}/${s.id}`);
    const target = s.measure(normalized);
    if (!Number.isFinite(target)) {
      // 교본에서 읽히지 않는 지표는 플레이어에게서도 읽히지 않는다.
      // 조용히 빼면 화면이 "일치도 100"이라고 말하면서 아무것도 재지 않는다.
      throw new Error(`기준 자세 ${id} 에서 지표 ${s.id} 를 잴 수 없다: ${target}`);
    }
    return { ...s, target };
  });

  return {
    id,
    labelKo: rig.labelKo,
    view: rig.view,
    judgedMotion: rig.judgedMotion,
    frame,
    metrics,
    sourceNote: rig.sourceNote,
  };
}

/**
 * 기준 자세 5종. 모듈이 읽힐 때 한 번 만든다.
 *
 * 순수 함수만 썼으므로(`Date.now()`·`Math.random()` 없음) 언제 만들어도 같은 값이고,
 * 같은 세션에서 두 번 만들 이유가 없다. 프레임 하나가 33 × 4 수라 비용도 무시할 만하다.
 */
export const REFERENCE_POSES: Readonly<Record<ReferencePoseId, ReferencePose>> = {
  ready: buildPose("ready"),
  juchum: buildPose("juchum"),
  "arae-makki": buildPose("arae-makki"),
  "momtong-an-makki": buildPose("momtong-an-makki"),
  "ap-chagi-apex": buildPose("ap-chagi-apex"),
};

export function referencePose(id: ReferencePoseId): ReferencePose {
  return REFERENCE_POSES[id];
}

/** 점수 라운드에 쓸 수 있는 자세인가 = 판정 규칙이 있는가. */
export function isJudged(pose: ReferencePose): boolean {
  return pose.judgedMotion !== null;
}

/**
 * 라운드마다 조금씩 다른 교본 — **합격대 안에서만** 움직인다.
 *
 * 문제를 바꾸려면 값을 바꿔야 하는데, 합격대 밖으로 나가면 **교본대로 한 사람이
 * 감점을 받는다.** 그러면 화면이 거짓말을 하는 것이고, 게임은 못 맞출 자세를 내라고
 * 시키는 셈이 된다. 그래서 판정 규칙이 있는 자세는 여기서 합격대를 검사한다 —
 * 판정 상수를 **읽어서** 검사하므로, 규칙표가 바뀌면 이 문이 함께 움직인다.
 *
 * 판정 규칙이 없는 자세(준비·막기)는 검사할 합격대 자체가 없다. 그쪽은 자유다.
 */
export function referencePoseVariant(
  id: ReferencePoseId,
  overrides: Partial<StanceParams> & Partial<KickParams>,
): ReferencePose {
  const frame = buildReferenceFrameWith(id, overrides);
  const base = REFERENCE_POSES[id];
  if (base.judgedMotion === "stance") assertStanceInPassBand(id, frame);
  return buildPose(id, frame);
}

/** 주춤서기 변형이 A1(발 간격)·A2(무릎)의 합격대 안인가. */
function assertStanceInPassBand(id: ReferencePoseId, frame: readonly Landmark[]): void {
  const S = Math.hypot(
    frame[11].x - frame[12].x,
    frame[11].y - frame[12].y,
    frame[11].z - frame[12].z,
  );
  const gap = Math.abs(frame[27].x - frame[28].x) / S;
  const [, passLo, passHi] = STANCE.feetGapBoundaries;
  if (gap < passLo || gap > passHi) {
    throw new Error(
      `기준 자세 ${id} 의 발 간격이 ${gap.toFixed(2)}·S 다. A1의 합격대 ${passLo}~${passHi} 밖이라 ` +
        `교본대로 한 사람이 감점을 받는다.`,
    );
  }
  const worstKnee = Math.max(kneeAngle(frame, LEFT_LEG), kneeAngle(frame, RIGHT_LEG));
  const kneePass = STANCE.kneeAngleBoundaries[0];
  if (!(worstKnee < kneePass)) {
    throw new Error(
      `기준 자세 ${id} 의 덜 굽은 무릎이 ${worstKnee.toFixed(1)}° 다. A2의 합격선 ${kneePass}° 밖이라 ` +
        `교본대로 한 사람이 감점을 받는다.`,
    );
  }
}
