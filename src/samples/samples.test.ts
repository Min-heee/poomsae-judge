/**
 * 공개 샘플의 골든 테스트.
 *
 * 두 가지를 확인한다.
 *  1. **재현성** — 커밋된 public/samples/*.json 이 지금 다시 구운 결과와 바이트까지 같은가.
 *     "이 JSON이 어디서 왔는가"에 생성 스크립트로 답할 수 있어야 한다는 약속의 시험이다.
 *  2. **의도한 판정** — 각 샘플이 만들어질 때 노린 등급을 실제로 받는가.
 *
 * 골든 테스트가 통과해도 규칙이 옳다는 증명은 아니다. 규칙이 어제와 같다는 증명이다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { judgeSequence } from "../judge";
import type { Grade } from "../judge/types";
import { buildAllSamples, buildManifest } from "./build";
import { decodeSequence, encodeSequence, stringifySampleFile, type SampleFile } from "./codec";

const SAMPLE_DIR = join(process.cwd(), "public", "samples");
const built = buildAllSamples();

/** 커밋된 파일을 읽어 시퀀스로 되돌린다. 앱이 런타임에 하는 일과 같다. */
function readCommitted(id: string): { text: string; file: SampleFile } {
  const text = readFileSync(join(SAMPLE_DIR, `${id}.json`), "utf8");
  return { text, file: JSON.parse(text) as SampleFile };
}

describe("재현성 — 커밋된 JSON == 다시 구운 결과", () => {
  for (const sample of built) {
    it(`${sample.sequence.id} 이 바이트까지 같다`, () => {
      const regenerated = stringifySampleFile(encodeSequence(sample.sequence, sample.intent));
      expect(regenerated).toBe(readCommitted(sample.sequence.id).text);
    });
  }

  it("manifest.json 도 같다", () => {
    const text = readFileSync(join(SAMPLE_DIR, "manifest.json"), "utf8");
    expect(JSON.stringify(buildManifest(built), null, 2) + "\n").toBe(text);
  });

  it("생성기가 시드 PRNG만 쓴다 — 두 번 구우면 같은 파일이 나온다", () => {
    const again = buildAllSamples();
    expect(JSON.stringify(again.map((s) => s.sequence))).toBe(
      JSON.stringify(built.map((s) => s.sequence)),
    );
  });
});

describe("파일 형식", () => {
  for (const sample of built) {
    it(`${sample.sequence.id} 파일이 200KB 이하다`, () => {
      const bytes = Buffer.byteLength(readCommitted(sample.sequence.id).text, "utf8");
      expect(bytes).toBeLessThanOrEqual(200 * 1024);
    });
  }

  it("좌표가 반올림돼 있다 — 부동소수점 끝자리로 골든이 흔들리지 않게", () => {
    const { file } = readCommitted("frontkick-good");
    for (const frame of file.frames.slice(0, 5)) {
      for (const lm of frame.lm) {
        expect(Number(lm[0].toFixed(4))).toBe(lm[0]);
        expect(Number(lm[3].toFixed(2))).toBe(lm[3]);
      }
    }
  });

  it("읽고 다시 쓰면 같은 값이 나온다", () => {
    const { file } = readCommitted("stance-good");
    const roundTripped = encodeSequence(decodeSequence(file), file.intent);
    expect(roundTripped.frames).toEqual(file.frames);
  });

  it("스키마 버전이 다르면 거부한다", () => {
    const { file } = readCommitted("stance-good");
    expect(() => decodeSequence({ ...file, schemaVersion: 99 })).toThrow(/스키마 버전/);
  });

  it("모든 샘플이 자기 출처를 들고 다닌다", () => {
    for (const sample of built) {
      const { file } = readCommitted(sample.sequence.id);
      expect(file.origin.length).toBeGreaterThan(10);
      expect(file.intent).toBe(sample.intent);
    }
  });
});

interface Expectation {
  status: "judged" | "withheld";
  score: number | null;
  /** 감점이 붙거나 보류된 항목만 적는다. 나머지는 전부 합격이어야 한다. */
  notPass: Record<string, { grade: Grade; deduction: number }>;
  /** 반드시 들어 있어야 하는 보류 코드. */
  withholdCodes?: string[];
}

const EXPECTED: Record<string, Expectation> = {
  "frontkick-good": { status: "judged", score: 10, notPass: {} },
  "frontkick-underextended": {
    status: "judged",
    score: 9.7,
    notPass: { B4: { grade: "major", deduction: 0.3 } },
  },
  "frontkick-balance-broken": {
    status: "judged",
    score: 9.3,
    notPass: {
      B2: { grade: "major", deduction: 0.3 },
      B5: { grade: "major", deduction: 0.3 },
      B6: { grade: "minor", deduction: 0.1 },
    },
  },
  "stance-good": { status: "judged", score: 10, notPass: {} },
  "stance-narrow": {
    status: "judged",
    score: 9.7,
    notPass: { A1: { grade: "major", deduction: 0.3 } },
  },
  "frontkick-occluded": {
    status: "withheld",
    score: null,
    notPass: {},
    withholdCodes: ["H1", "H2"],
  },
  "frontkick-dropped-frames": {
    status: "withheld",
    score: null,
    // 빠진 프레임이 하필 정점이라 B4가 원본(합격)과 다른 등급을 낸다.
    // 이것이 H3으로 보류하는 이유 그 자체다 — 아래에 따로 시험을 둔다.
    notPass: { B4: { grade: "minor", deduction: 0.1 } },
    withholdCodes: ["H3"],
  },
};

describe("샘플이 의도한 판정을 받는다", () => {
  for (const [id, expected] of Object.entries(EXPECTED)) {
    it(`${id} → ${expected.status} ${expected.score ?? "(보류)"}`, () => {
      const judgement = judgeSequence(decodeSequence(readCommitted(id).file));
      expect(judgement.status).toBe(expected.status);
      expect(judgement.score).toBe(expected.score);

      for (const criterion of judgement.criteria) {
        const want = expected.notPass[criterion.id];
        if (want === undefined) {
          expect(
            { id: criterion.id, grade: criterion.grade },
            `${criterion.id}은 합격이어야 한다 (측정값 ${criterion.measured})`,
          ).toEqual({ id: criterion.id, grade: "pass" });
        } else {
          expect({ id: criterion.id, grade: criterion.grade, deduction: criterion.deduction }).toEqual({
            id: criterion.id,
            ...want,
          });
        }
      }

      for (const code of expected.withholdCodes ?? []) {
        expect(judgement.withheld.map((w) => w.code)).toContain(code);
      }
    });
  }

  it("가림 샘플은 어느 프레임이 왜 흐린지 말한다 (PRD 3절 사용자 C)", () => {
    const judgement = judgeSequence(decodeSequence(readCommitted("frontkick-occluded").file));
    const h1 = judgement.withheld.find((w) => w.code === "H1");
    expect(h1?.message).toContain("오른쪽 무릎");
    expect(h1?.frames?.length).toBeGreaterThan(0);
  });

  it("끊긴 샘플은 어디가 몇 ms 비었는지 말한다", () => {
    const judgement = judgeSequence(decodeSequence(readCommitted("frontkick-dropped-frames").file));
    const h3 = judgement.withheld.find((w) => w.code === "H3");
    expect(h3?.message).toMatch(/\d+ms 비었다/);
  });

  it("프레임이 끊기면 실제로 다른 값이 나온다 — 그래서 보류한다", () => {
    const intact = judgeSequence(decodeSequence(readCommitted("frontkick-good").file));
    const broken = judgeSequence(decodeSequence(readCommitted("frontkick-dropped-frames").file));
    const b4 = (j: typeof intact) => j.criteria.find((c) => c.id === "B4");
    expect(intact.status).toBe("judged");
    expect(b4(intact)?.grade).toBe("pass");
    // 같은 동작인데 정점 프레임이 사라져 덜 펴진 것처럼 보인다.
    expect(b4(broken)!.measured!).toBeLessThan(b4(intact)!.measured!);
    expect(broken.status).toBe("withheld");
    expect(broken.score).toBeNull();
  });

  it("손상 샘플이 원본과 같은 동작에서 나왔다 — 관측만 나빠진 것이다", () => {
    const good = readCommitted("frontkick-good").file;
    const occluded = readCommitted("frontkick-occluded").file;
    expect(occluded.frames.length).toBe(good.frames.length);
    // 좌표는 그대로고 신뢰도만 다르다.
    const coords = (f: SampleFile) => f.frames.map((fr) => fr.lm.map((p) => p.slice(0, 3)));
    expect(coords(occluded)).toEqual(coords(good));
  });
});

describe("manifest", () => {
  it("모든 샘플이 목록에 있고 파일 이름이 맞다", () => {
    const manifest = JSON.parse(readFileSync(join(SAMPLE_DIR, "manifest.json"), "utf8")) as {
      samples: { id: string; file: string; intent: string }[];
    };
    expect(manifest.samples.map((s) => s.id).sort()).toEqual(
      built.map((s) => s.sequence.id).sort(),
    );
    for (const entry of manifest.samples) {
      expect(entry.file).toBe(`${entry.id}.json`);
      expect(entry.intent.length).toBeGreaterThan(0);
    }
  });

  it("샘플이 3종 이상이다 (PRD F1)", () => {
    expect(built.length).toBeGreaterThanOrEqual(3);
  });
});
