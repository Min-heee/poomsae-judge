/**
 * 교본 오버레이의 시험.
 *
 * 이 파일이 생긴 이유: `imageMapOf`·`fitReferenceToFrame`·`fitReferenceStandalone` 은
 * '교본 오버레이' 기능의 정확성이 통째로 걸린 순수 함수인데 시험이 **0개**였다.
 * 캔버스가 필요 없는 함수들인데도 그랬고, 더 나쁜 것은 **실패가 조용하다**는 점이다 —
 * 어긋남 색은 비교 코어가 world 좌표로 정하고 이 파일은 image 좌표로 점만 찍으므로,
 * 변환이 깨져 고스트가 엉뚱한 자리에 그려져도 관절 색은 여전히 "맞음"이라고 말한다.
 * 화면만 보고는 알 수 없다. 그래서 숫자로 못을 박는다.
 *
 * 입력은 이미 커밋된 합성 픽스처를 그대로 쓴다. DOM 도 캔버스도 쓰지 않는다.
 */

import { describe, expect, it } from "vitest";

import { LM } from "@/judge/landmarks";
import type { Landmark, LandmarkSequence } from "@/judge/types";
import { projectFrames } from "@/pose/sequence";
import type { PoseFrame } from "@/pose/types";
import { kickSequence, staticStanceSequence } from "@/samples/fixtures";
import {
  OVERLAY_COLORS,
  bandColor,
  fitReferenceStandalone,
  fitReferenceToFrame,
  imageMapOf,
  metricDeltaText,
  metricText,
} from "./overlay";

const ASPECT = 4 / 3;

/** 시퀀스를 화면 계층이 실제로 쓰는 모양(두 좌표계)으로 바꾼다. */
function framesOf(seq: LandmarkSequence, aspect = ASPECT): PoseFrame[] {
  const world = seq.frames.map((f) => f.landmarks as Landmark[]);
  const image = projectFrames(world, aspect);
  return seq.frames.map((f, i) => ({ t: f.t, world: world[i], image: image[i] }));
}

/** 엉덩이 중점을 기준으로 프레임 전체를 k배 한다. 자세는 그대로고 크기만 달라진다. */
function scaleAboutHip(lms: readonly Landmark[], k: number): Landmark[] {
  const hx = (lms[LM.leftHip].x + lms[LM.rightHip].x) / 2;
  const hy = (lms[LM.leftHip].y + lms[LM.rightHip].y) / 2;
  return lms.map((p) => ({ ...p, x: hx + (p.x - hx) * k, y: hy + (p.y - hy) * k }));
}

const frontal = framesOf(staticStanceSequence({ frames: 60 }));
const sagittal = framesOf(kickSequence());

describe("프레임에서 world→image 변환을 복원한다", () => {
  it("복원한 변환으로 33점을 다시 투영하면 원래 image 좌표가 나온다", () => {
    const frame = frontal[10];
    const map = imageMapOf(frame, ASPECT);
    expect(map).not.toBeNull();
    if (!map) return;
    for (let i = 0; i < 33; i++) {
      expect(map.ox + map.sx * frame.world[i].x).toBeCloseTo(frame.image[i].x, 9);
      expect(map.oy + map.sy * frame.world[i].y).toBeCloseTo(frame.image[i].y, 9);
    }
  });

  it("x 배율은 y 배율을 종횡비로 나눈 값이다 — 두 축을 따로 재지 않는다", () => {
    for (const aspect of [1, 4 / 3, 16 / 9]) {
      const f = framesOf(staticStanceSequence({ frames: 30 }), aspect)[5];
      const map = imageMapOf(f, aspect);
      expect(map).not.toBeNull();
      if (!map) return;
      expect(map.sx).toBeCloseTo(map.sy / aspect, 12);
    }
  });

  it("점이 모자라면 추측하지 않고 null 을 낸다", () => {
    const empty = { t: 0, world: [], image: [] } as unknown as PoseFrame;
    expect(imageMapOf(empty, ASPECT)).toBeNull();
  });
});

describe("측면 촬영에서도 배율이 무너지지 않는다", () => {
  it("측면 프레임은 두 어깨의 화면 평면 폭이 0에 수렴한다 — 그것이 함정이다", () => {
    const f = sagittal[Math.floor(sagittal.length / 2)];
    const shoulderSpan = Math.abs(f.world[LM.leftShoulder].x - f.world[LM.rightShoulder].x);
    const torso = Math.abs(
      (f.world[LM.leftShoulder].y + f.world[LM.rightShoulder].y) / 2 -
        (f.world[LM.leftHip].y + f.world[LM.rightHip].y) / 2,
    );
    // 어깨 폭으로 나누면 교본이 수백 배로 부푼다. 몸통 길이는 멀쩡하다.
    expect(shoulderSpan).toBeLessThan(torso * 0.05);
    expect(torso).toBeGreaterThan(0.1);
  });

  it("그래도 교본이 화면 안에 놓인다", () => {
    const f = sagittal[Math.floor(sagittal.length / 2)];
    const ghost = fitReferenceToFrame(f, f.world, ASPECT);
    expect(ghost).not.toBeNull();
    if (!ghost) return;
    for (const p of ghost) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Math.abs(p.x)).toBeLessThan(2);
      expect(Math.abs(p.y)).toBeLessThan(2);
    }
  });
});

describe("교본을 내 프레임과 같은 자 위에 놓는다", () => {
  it("교본이 곧 나 자신이면 내 image 좌표로 되돌아온다(항등)", () => {
    for (const frame of [frontal[20], sagittal[20]]) {
      const ghost = fitReferenceToFrame(frame, frame.world, ASPECT);
      expect(ghost).not.toBeNull();
      if (!ghost) return;
      for (let i = 0; i < 33; i++) {
        expect(ghost[i].x).toBeCloseTo(frame.image[i].x, 9);
        expect(ghost[i].y).toBeCloseTo(frame.image[i].y, 9);
      }
    }
  });

  it("교본의 크기는 결과에 영향이 없다 — 몸통 길이로 맞추기 때문이다", () => {
    const frame = frontal[20];
    const asIs = fitReferenceToFrame(frame, frame.world, ASPECT);
    const tripled = fitReferenceToFrame(frame, scaleAboutHip(frame.world, 3), ASPECT);
    expect(asIs).not.toBeNull();
    expect(tripled).not.toBeNull();
    if (!asIs || !tripled) return;
    for (let i = 0; i < 33; i++) {
      expect(tripled[i].x).toBeCloseTo(asIs[i].x, 9);
      expect(tripled[i].y).toBeCloseTo(asIs[i].y, 9);
    }
  });

  it("교본은 언제나 '읽은' 좌표다 — 흐림 점선이 붙을 자리가 없다", () => {
    const ghost = fitReferenceToFrame(frontal[20], frontal[20].world, ASPECT);
    expect(ghost?.every((p) => p.visibility === 1)).toBe(true);
  });

  it("겹칠 사람이 없으면 몸통·팔다리가 화면 안에 들어오게 놓는다", () => {
    const solo = fitReferenceStandalone(frontal[20].world, ASPECT);
    expect(solo).not.toBeNull();
    if (!solo) return;
    // 배율은 몸통·팔다리 12점으로 정한다(얼굴은 잡음이 커서 뺀다). 그 12점을 본다.
    const body = [
      LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow,
      LM.leftWrist, LM.rightWrist, LM.leftHip, LM.rightHip,
      LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle,
    ].map((i) => solo[i]);
    for (const p of body) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(1);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(1);
    }
    // 가운데에 놓인다 — 12점의 경계상자 중심이 화면 중심이다.
    const cx = (Math.min(...body.map((p) => p.x)) + Math.max(...body.map((p) => p.x))) / 2;
    const cy = (Math.min(...body.map((p) => p.y)) + Math.max(...body.map((p) => p.y))) / 2;
    expect(cx).toBeCloseTo(0.5, 9);
    expect(cy).toBeCloseTo(0.5, 9);
  });
});

describe("색 규약", () => {
  /** globals.css 의 판정 층 토큰. 여기 적힌 값과 같아지면 층이 섞인 것이다. */
  const JUDGE_BAD = "#f78787";
  const JUDGE_WARN = "#f2c15b";

  it("어긋남 색은 감점 색이 아니다", () => {
    expect(OVERLAY_COLORS.off).not.toBe(JUDGE_BAD);
    expect(OVERLAY_COLORS.warn).not.toBe(JUDGE_WARN);
    // 흐림(점선)과도 달라야 한다 — 표현만이 아니라 색으로도 갈린다.
    expect(OVERLAY_COLORS.off).not.toBe(OVERLAY_COLORS.weak);
  });

  it("읽지 못한 관절과 비교하지 않은 관절은 아무 색도 받지 않는다", () => {
    expect(bandColor("unreadable")).toBeNull();
    expect(bandColor("none")).toBeNull();
    expect(bandColor("ok")).toBeNull();
    expect(bandColor("warn")).toBe(OVERLAY_COLORS.warn);
    expect(bandColor("off")).toBe(OVERLAY_COLORS.off);
  });
});

describe("숫자 문자열은 한 출처에서 나온다", () => {
  const metric = {
    id: "knee",
    labelKo: "왼쪽 무릎",
    side: "left" as const,
    unit: "deg" as const,
    target: 138,
    measured: 150,
    diff: 12,
    band: "warn" as const,
    score: 50,
    weight: 10,
    joints: [LM.leftKnee],
    hintKo: "",
  };

  it("문장은 이름 + 숫자로 조립된다 — 표가 문장을 되파싱하지 않아도 된다", () => {
    expect(metricDeltaText(metric)).toBe("+12.0°");
    expect(metricText(metric)).toBe(`${metric.labelKo} ${metricDeltaText(metric)}`);
  });

  it("부호를 남긴다 — 덜 굽은 것과 더 굽은 것은 고치는 법이 반대다", () => {
    expect(metricDeltaText({ ...metric, diff: -12 })).toBe("−12.0°");
    expect(metricDeltaText({ ...metric, unit: "ratio", diff: 0.415 })).toBe("+0.41·S");
    expect(metricDeltaText({ ...metric, diff: null, measured: null })).toBe("읽지 못함");
  });
});
