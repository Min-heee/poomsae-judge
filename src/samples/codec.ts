/**
 * 샘플 JSON의 형식.
 *
 * 좌표를 반드시 반올림해서 고정한다. 부동소수점 끝자리가 흔들리면 골든 테스트가
 * 이유 없이 깨지고, 파일도 쓸데없이 커진다. 1e-4 m = 0.1mm 면 어떤 규칙에도 충분하다.
 *
 * 한 프레임을 [x, y, z, visibility] 33개로 눕혀 담는다. 키 이름을 33번 반복하지 않으므로
 * 파일이 3분의 1로 줄고, fields 배열이 무슨 순서인지 파일 안에서 말해 준다.
 */

import { LANDMARK_COUNT } from "../judge/landmarks";
import type { Landmark, LandmarkSequence } from "../judge/types";

export const SAMPLE_SCHEMA_VERSION = 1;

/** 좌표 소수 자리수(m). 0.1mm. */
export const COORD_DIGITS = 4;
/** 신뢰도 소수 자리수. */
export const VISIBILITY_DIGITS = 2;

export interface SampleFile {
  schemaVersion: number;
  id: string;
  label: string;
  motion: "stance" | "frontKick";
  view: "frontal" | "sagittal";
  fps: number;
  origin: string;
  /** 이 샘플이 어떤 판정을 받도록 만들어졌는가. 사람이 읽는 메모다. */
  intent?: string;
  landmarkCount: number;
  units: string;
  fields: readonly ["x", "y", "z", "visibility"];
  frames: readonly { t: number; lm: readonly number[][] }[];
}

function fix(value: number, digits: number): number {
  const f = 10 ** digits;
  const r = Math.round(value * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export function encodeSequence(
  sequence: LandmarkSequence,
  intent?: string,
): SampleFile {
  return {
    schemaVersion: SAMPLE_SCHEMA_VERSION,
    id: sequence.id,
    label: sequence.label,
    motion: sequence.motion,
    view: sequence.view,
    fps: sequence.fps,
    origin: sequence.origin ?? "",
    ...(intent === undefined ? {} : { intent }),
    landmarkCount: LANDMARK_COUNT,
    units: "meters, hip-midpoint origin, y increases downward",
    fields: ["x", "y", "z", "visibility"],
    frames: sequence.frames.map((f) => ({
      t: fix(f.t, 1),
      lm: f.landmarks.map((p) => [
        fix(p.x, COORD_DIGITS),
        fix(p.y, COORD_DIGITS),
        fix(p.z, COORD_DIGITS),
        fix(p.visibility, VISIBILITY_DIGITS),
      ]),
    })),
  };
}

export function decodeSequence(file: SampleFile): LandmarkSequence {
  if (file.schemaVersion !== SAMPLE_SCHEMA_VERSION) {
    throw new Error(
      `샘플 스키마 버전이 다르다: 파일 ${file.schemaVersion}, 기대 ${SAMPLE_SCHEMA_VERSION}.`,
    );
  }
  if (file.landmarkCount !== LANDMARK_COUNT) {
    throw new Error(`랜드마크 수가 ${file.landmarkCount}다. ${LANDMARK_COUNT}여야 한다.`);
  }
  return {
    id: file.id,
    label: file.label,
    motion: file.motion,
    view: file.view,
    fps: file.fps,
    origin: file.origin,
    frames: file.frames.map((f) => ({
      t: f.t,
      landmarks: f.lm.map(
        (a): Landmark => ({ x: a[0], y: a[1], z: a[2], visibility: a[3] }),
      ),
    })),
  };
}

/** 파일에 쓸 문자열. 한 프레임을 한 줄로 두어 diff가 읽히게 한다. */
export function stringifySampleFile(file: SampleFile): string {
  const head = {
    ...file,
    frames: "__FRAMES__" as unknown as SampleFile["frames"],
  };
  const body = file.frames
    .map((f) => `    {"t":${f.t},"lm":[${f.lm.map((p) => `[${p.join(",")}]`).join(",")}]}`)
    .join(",\n");
  return JSON.stringify(head, null, 2).replace(
    '"__FRAMES__"',
    `[\n${body}\n  ]`,
  ) + "\n";
}
