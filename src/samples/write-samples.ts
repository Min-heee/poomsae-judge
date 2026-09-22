/**
 * public/samples/*.json 을 다시 굽는 스크립트.
 *
 * 저장소 루트에서:
 *   npx vite-node src/samples/write-samples.ts
 *
 * (vite-node 는 vitest 가 이미 끌고 오는 패키지라 따로 설치할 것이 없다.)
 *
 * 시드가 고정돼 있으므로 누가 언제 돌려도 같은 바이트가 나온다.
 * 그 성질은 src/samples/samples.test.ts 가 매 테스트마다 확인한다 —
 * 커밋된 JSON과 지금 다시 구운 결과가 다르면 테스트가 깨진다.
 *
 * 이 파일은 앱 번들에 들어가지 않는다. 어떤 화면도 이것을 import 하지 않는다.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildAllSamples, buildManifest } from "./build";
import { encodeSequence, stringifySampleFile } from "./codec";

const OUT_DIR = join(process.cwd(), "public", "samples");

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const samples = buildAllSamples();

  for (const sample of samples) {
    const file = encodeSequence(sample.sequence, sample.intent);
    const text = stringifySampleFile(file);
    const path = join(OUT_DIR, `${sample.sequence.id}.json`);
    writeFileSync(path, text, "utf8");
    const kb = (Buffer.byteLength(text, "utf8") / 1024).toFixed(1);
    console.log(`${sample.sequence.id.padEnd(26)} ${String(file.frames.length).padStart(3)}프레임  ${kb.padStart(7)} KB`);
  }

  const manifest = buildManifest(samples);
  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`manifest.json                ${samples.length}개 샘플`);
}

main();
