/**
 * 통합 이음매 테스트 — 브라우저가 실제로 지나는 경로.
 *
 * 왜 이 파일이 따로 필요한가:
 * `public/samples/*.json` 을 읽는 코드가 **두 벌** 있다.
 *   - 판정/생성 쪽: `src/samples/codec.ts` 의 `decodeSequence` (엄격. 스키마 버전을 본다)
 *   - 화면 쪽:      `src/pose/sequence.ts` 의 `normalizeSequence` (느슨. 여러 키 이름을 받는다)
 *
 * `src/samples/samples.test.ts` 는 앞의 것만 확인한다. 그래서 두 파서가 어긋나면
 * 테스트는 전부 통과하는데 **브라우저에서만 점수가 달라지는** 구멍이 생긴다.
 * 여기서 화면 경로로 같은 파일을 읽어 같은 판정이 나오는지 못 박는다.
 *
 * 실제 화면 경로는 `loadSamples()`(fetch) → `normalizeSequence` → `judgePose` 인데,
 * fetch 만 파일 읽기로 바꿔 끼웠다. 파싱과 판정은 화면과 같은 함수를 지난다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeSequence,
  encodeSequence,
  stringifySampleFile,
  type SampleFile,
} from "@/samples/codec";
import { judgeSequence } from "@/judge";
import { judgePose } from "./judge-adapter";
import { normalizeSequence, SequenceFormatError } from "./sequence";
import { toLandmarkSequence, type MotionKind } from "./types";

const SAMPLE_DIR = join(process.cwd(), "public", "samples");

interface ManifestEntry {
  id: string;
  file: string;
  label: string;
  motion: MotionKind;
  intent: string;
}

const manifest = JSON.parse(readFileSync(join(SAMPLE_DIR, "manifest.json"), "utf8")) as {
  samples: ManifestEntry[];
};

function readSample(file: string): unknown {
  return JSON.parse(readFileSync(join(SAMPLE_DIR, file), "utf8"));
}

/**
 * 배포된 샘플이 받아야 하는 판정. 규칙표를 고치면 여기도 같이 깨져야 한다.
 * 화면에서 눈으로 확인한 값과 같은 표다.
 */
const EXPECTED: Record<string, { status: "judged" | "withheld"; score: number | null }> = {
  "frontkick-good": { status: "judged", score: 10 },
  "frontkick-underextended": { status: "judged", score: 9.7 },
  "frontkick-balance-broken": { status: "judged", score: 9.3 },
  "stance-good": { status: "judged", score: 10 },
  "stance-narrow": { status: "judged", score: 9.7 },
  "frontkick-occluded": { status: "withheld", score: null },
  "frontkick-dropped-frames": { status: "withheld", score: null },
};

describe("manifest 가 가리키는 파일이 전부 있다", () => {
  it("7개를 싣고 있다", () => {
    expect(manifest.samples).toHaveLength(7);
  });

  for (const entry of manifest.samples) {
    it(`${entry.id}: 파일이 읽히고 id 가 맞는다`, () => {
      const raw = readSample(entry.file) as { id?: string };
      expect(raw.id).toBe(entry.id);
    });
  }
});

describe("화면 경로로 읽어도 같은 판정이 나온다", () => {
  for (const entry of manifest.samples) {
    it(`${entry.id}: 두 파서가 같은 점수를 낸다`, () => {
      const raw = readSample(entry.file);

      // 화면 경로: 느슨한 파서 → PoseSequence → 판정
      const viaScreen = judgePose(
        normalizeSequence(raw, {
          id: entry.id,
          origin: "sample",
          motionHint: entry.motion,
          labelHint: entry.label,
          noteHint: entry.intent,
        }),
      );

      // 코어 경로: 엄격한 파서 → LandmarkSequence → 판정
      const viaCore = judgeSequence(decodeSequence(raw as SampleFile));

      expect(viaScreen.status).toBe(viaCore.status);
      expect(viaScreen.score).toBe(viaCore.score);
      expect(viaScreen.totalDeduction).toBe(viaCore.totalDeduction);
      // 감점이 걸린 항목과 그 크기까지 같아야 한다.
      expect(viaScreen.criteria.map((c) => [c.id, c.grade, c.deduction])).toEqual(
        viaCore.criteria.map((c) => [c.id, c.grade, c.deduction]),
      );
    });

    it(`${entry.id}: 배포된 파일이 의도한 판정을 받는다`, () => {
      const expected = EXPECTED[entry.id];
      expect(expected, `${entry.id} 의 기대값이 표에 없다`).toBeDefined();

      const judgement = judgePose(
        normalizeSequence(readSample(entry.file), {
          id: entry.id,
          origin: "sample",
          motionHint: entry.motion,
        }),
      );

      expect(judgement.status).toBe(expected.status);
      expect(judgement.score).toBe(expected.score);
    });
  }
});

describe("보류는 0점이 아니다", () => {
  const withheldIds = manifest.samples
    .map((s) => s.id)
    .filter((id) => EXPECTED[id].status === "withheld");

  it("보류 샘플이 실제로 있다", () => {
    expect(withheldIds.length).toBeGreaterThan(0);
  });

  for (const id of withheldIds) {
    it(`${id}: score 가 null 이고 사유가 붙는다`, () => {
      const entry = manifest.samples.find((s) => s.id === id);
      if (entry === undefined) throw new Error(`${id} 가 manifest 에 없다`);
      const judgement = judgePose(
        normalizeSequence(readSample(entry.file), {
          id,
          origin: "sample",
          motionHint: entry.motion,
        }),
      );
      expect(judgement.score).toBeNull();
      expect(judgement.score).not.toBe(0);
      expect(judgement.withheld.length).toBeGreaterThan(0);
    });
  }
});

describe("판정은 화면 경로에서도 결정적이다", () => {
  it("같은 파일을 두 번 읽어 두 번 판정해도 결과가 같다", () => {
    for (const entry of manifest.samples) {
      const run = () =>
        JSON.stringify(
          judgePose(
            normalizeSequence(readSample(entry.file), {
              id: entry.id,
              origin: "sample",
              motionHint: entry.motion,
            }),
          ),
        );
      expect(run()).toBe(run());
    }
  });
});

/**
 * 느슨한 파서가 조용히 채워 넣던 값들.
 *
 * 아래 세 성질은 한동안 **어떤 테스트도 지키지 않았다** — 변이를 넣어도 전부
 * 통과했다. 화면 경로만 지나가는 코드라 판정 코어 테스트의 사정권 밖이었다.
 */
describe("화면 파서가 모르는 값을 지어내지 않는다", () => {
  const occluded = manifest.samples.find((s) => s.id === "frontkick-occluded");
  if (occluded === undefined) throw new Error("frontkick-occluded 가 manifest 에 없다");

  function strippedVisibility(): unknown {
    // 좌표는 그대로 두고 네 번째 칸(visibility)만 지운다.
    const raw = readSample(occluded!.file) as {
      fields?: unknown;
      frames: { t: number; lm: number[][] }[];
    };
    delete raw.fields; // fields 검사와 분리해서 신뢰도 처리만 본다
    return {
      ...raw,
      frames: raw.frames.map((f) => ({ ...f, lm: f.lm.map((p) => p.slice(0, 3)) })),
    };
  }

  it("신뢰도 칸이 없으면 거부한다 — 보류가 만점으로 새지 않는다", () => {
    expect(() =>
      normalizeSequence(strippedVisibility(), { id: "stripped", origin: "sample" }),
    ).toThrow(SequenceFormatError);
  });

  it("원본은 여전히 보류다 — 위 검사가 막은 것이 무엇인지 못 박는다", () => {
    const j = judgePose(
      normalizeSequence(readSample(occluded.file), { id: occluded.id, origin: "sample" }),
    );
    expect(j.status).toBe("withheld");
    expect(j.score).toBeNull();
    expect(j.withheld.map((w) => w.code)).toContain("H2");
  });

  it("객체 형태 랜드마크의 낮은 신뢰도도 그대로 읽는다", () => {
    const raw = readSample(occluded.file) as { frames: { t: number; lm: number[][] }[] };
    const asObjects = {
      motion: "frontKick",
      view: "sagittal",
      fps: 30,
      frames: raw.frames.map((f) => ({
        t: f.t,
        lm: f.lm.map((p) => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] })),
      })),
    };
    const seq = normalizeSequence(asObjects, { id: "objects", origin: "sample" });
    const vis = seq.frames.flatMap((f) => f.world.map((l) => l.visibility));
    expect(Math.min(...vis)).toBeLessThan(0.5);
    expect(judgePose(seq).status).toBe("withheld");
  });

  it("객체 형태에 visibility 가 없으면 거부한다", () => {
    const bad = {
      motion: "stance",
      frames: [
        {
          t: 0,
          lm: Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 })),
        },
      ],
    };
    expect(() => normalizeSequence(bad, { id: "bad", origin: "sample" })).toThrow(
      SequenceFormatError,
    );
  });

  it("파일이 선언한 fields 순서가 다르면 거부한다", () => {
    const raw = readSample(occluded.file) as Record<string, unknown>;
    const swapped = { ...raw, fields: ["x", "y", "visibility", "z"] };
    expect(() => normalizeSequence(swapped, { id: "swapped", origin: "sample" })).toThrow(
      SequenceFormatError,
    );
  });
});

describe("화면 파서의 시간축과 기본값", () => {
  const good = manifest.samples.find((s) => s.id === "stance-good");
  if (good === undefined) throw new Error("stance-good 이 manifest 에 없다");

  it("프레임 순서가 뒤섞여 들어와도 시간순으로 세운다", () => {
    const raw = readSample(good.file) as { frames: unknown[] };
    const shuffled = { ...raw, frames: [...raw.frames].reverse() };
    const seq = normalizeSequence(shuffled, { id: "shuffled", origin: "sample" });
    for (let i = 1; i < seq.frames.length; i += 1) {
      expect(seq.frames[i].t).toBeGreaterThanOrEqual(seq.frames[i - 1].t);
    }
    // 순서를 세웠으므로 판정도 원본과 같아야 한다.
    const original = normalizeSequence(readSample(good.file), { id: good.id, origin: "sample" });
    expect(judgePose(seq).score).toBe(judgePose(original).score);
  });

  it("aspect 는 없으면 4:3, 있으면 그 값을 쓴다 — 그리기에만 영향을 준다", () => {
    const raw = readSample(good.file) as Record<string, unknown>;
    const withoutAspect = normalizeSequence(raw, { id: good.id, origin: "sample" });
    const withAspect = normalizeSequence({ ...raw, aspect: 16 / 9 }, { id: good.id, origin: "sample" });
    expect(withoutAspect.aspect).toBeCloseTo(4 / 3, 12);
    expect(withAspect.aspect).toBeCloseTo(16 / 9, 12);
    // 판정은 world 좌표만 보므로 aspect 가 달라도 점수는 같다.
    expect(judgePose(withAspect).score).toBe(judgePose(withoutAspect).score);
  });
});

/**
 * F6 — 내보낸 JSON 을 다시 넣으면 같은 점수가 나온다.
 *
 * 화면의 "시퀀스 JSON 내보내기"가 쓰는 함수(`encodeSequence`/`stringifySampleFile`)와
 * 불러오기가 쓰는 함수(`normalizeSequence`)를 그대로 이어 붙여 확인한다.
 * 이 고리가 닫혀 있어야 웹캠으로 찍은 것을 샘플로 되먹일 수 있다.
 */
describe("F6 — 내보내고 다시 읽어도 같은 판정", () => {
  for (const entry of manifest.samples) {
    it(`${entry.id}: 왕복 후에도 점수와 감점이 같다`, () => {
      const loaded = normalizeSequence(readSample(entry.file), {
        id: entry.id,
        origin: "sample",
        motionHint: entry.motion,
      });
      const before = judgePose(loaded);

      const text = stringifySampleFile(encodeSequence(toLandmarkSequence(loaded), entry.intent));
      const reloaded = normalizeSequence(JSON.parse(text), {
        id: entry.id,
        origin: "imported",
      });
      const after = judgePose(reloaded);

      expect(after.status).toBe(before.status);
      expect(after.score).toBe(before.score);
      expect(after.criteria.map((c) => [c.id, c.grade, c.deduction])).toEqual(
        before.criteria.map((c) => [c.id, c.grade, c.deduction]),
      );
      expect(after.withheld.map((w) => w.code)).toEqual(before.withheld.map((w) => w.code));
    });
  }

  it("내보낸 파일은 칸 순서를 스스로 선언한다", () => {
    const loaded = normalizeSequence(readSample(manifest.samples[0].file), {
      id: manifest.samples[0].id,
      origin: "sample",
    });
    const file = encodeSequence(toLandmarkSequence(loaded));
    expect(file.fields).toEqual(["x", "y", "z", "visibility"]);
    expect(file.landmarkCount).toBe(33);
  });
});
