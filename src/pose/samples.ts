/**
 * 샘플 랜드마크 시퀀스를 읽어 온다.
 *
 * 샘플은 `public/samples/` 에 있고 `src/samples/write-samples.ts` 가 굽는다.
 * 목록 파일이 없어도 동작해야 하므로 순서는 이렇다.
 *   1) `samples/manifest.json`(또는 `index.json`)이 있으면 그 목록을 쓴다.
 *   2) 없으면 정해 둔 후보 이름으로 하나씩 찔러 본다.
 *   3) 하나도 못 읽으면 **빈 목록과 사유**를 돌려준다. 지어낸 시퀀스로 화면을
 *      채우지 않는다 — 무엇을 보고 있는지 모르는 화면이 빈 화면보다 나쁘다.
 *
 * `basePath` 주의: GitHub Pages 프로젝트 페이지에서는 앱이 `/poomsae-judge` 아래
 * 붙는데, Next 의 basePath 는 fetch 경로에 **자동으로 붙지 않는다**
 * (docs/TECH-NOTES.md 7절 3번). 그래서 여기서 직접 붙인다.
 */

import { normalizeSequence, SequenceFormatError } from "./sequence";
import type { MotionKind, PoseSequence } from "./types";

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function assetUrl(path: string): string {
  const clean = path.startsWith("/") ? path.slice(1) : path;
  return `${BASE_PATH}/${clean}`;
}

interface CatalogEntry {
  id: string;
  file?: string;
  label?: string;
  motion?: MotionKind;
  /** 목록이 알고 있는 "이 샘플이 무엇을 보이려는가" 한 줄 */
  intent?: string;
}

/** 목록 파일 후보. 생성 스크립트가 쓰는 이름이 먼저다. */
const MANIFEST_FILES = ["samples/manifest.json", "samples/index.json"];

/** 목록 파일이 없을 때 찔러 볼 이름들. manifest.json 이 있으면 쓰이지 않는다. */
const FALLBACK_IDS: { id: string; motion: MotionKind }[] = [
  { id: "stance-good", motion: "stance" },
  { id: "stance-narrow", motion: "stance" },
  { id: "frontkick-good", motion: "frontKick" },
  { id: "frontkick-underextended", motion: "frontKick" },
  { id: "frontkick-balance-broken", motion: "frontKick" },
  { id: "frontkick-occluded", motion: "frontKick" },
  { id: "frontkick-dropped-frames", motion: "frontKick" },
];

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function readCatalog(raw: unknown): CatalogEntry[] | null {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { samples?: unknown }).samples)
      ? ((raw as { samples: unknown[] }).samples as unknown[])
      : null;
  if (!list) return null;

  const entries: CatalogEntry[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      entries.push({ id: item });
      continue;
    }
    if (typeof item === "object" && item !== null) {
      const o = item as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id : typeof o.file === "string" ? o.file : null;
      if (!id) continue;
      entries.push({
        id: id.replace(/\.json$/i, ""),
        file: typeof o.file === "string" ? o.file : undefined,
        label: typeof o.label === "string" ? o.label : undefined,
        intent: typeof o.intent === "string" ? o.intent : undefined,
        motion:
          o.motion === "stance" || o.motion === "frontKick" ? (o.motion as MotionKind) : undefined,
      });
    }
  }
  return entries.length > 0 ? entries : null;
}

export interface SampleLoadResult {
  sequences: PoseSequence[];
  /** 읽다가 생긴 문제들. 조용히 삼키지 않고 화면에 띄운다. */
  problems: string[];
}

export async function loadSamples(): Promise<SampleLoadResult> {
  const problems: string[] = [];

  let fromManifest: CatalogEntry[] | null = null;
  for (const file of MANIFEST_FILES) {
    const raw = await fetchJson(assetUrl(file));
    if (raw === null) continue;
    fromManifest = readCatalog(raw);
    if (fromManifest) break;
  }
  const catalog: CatalogEntry[] =
    fromManifest ?? FALLBACK_IDS.map((f): CatalogEntry => ({ id: f.id, motion: f.motion }));

  // 순차로 받으면 7개가 왕복 7번이 된다. 병렬로 받되 목록의 순서는 그대로 지킨다.
  const loaded = await Promise.all(
    catalog.map(async (entry): Promise<PoseSequence | null> => {
      const file = entry.file ?? `${entry.id}.json`;
      const raw = await fetchJson(assetUrl(`samples/${file}`));
      if (raw === null) return null;
      try {
        return normalizeSequence(raw, {
          id: entry.id,
          origin: "sample",
          motionHint: entry.motion,
          labelHint: entry.label,
          noteHint: entry.intent,
        });
      } catch (err) {
        problems.push(
          `${file}: ${err instanceof SequenceFormatError ? err.message : "읽을 수 없는 형식"}`,
        );
        return null;
      }
    }),
  );
  const sequences: PoseSequence[] = loaded.filter((s): s is PoseSequence => s !== null);

  if (sequences.length === 0) {
    problems.push(
      `${assetUrl("samples/")} 에서 읽을 수 있는 샘플이 하나도 없습니다. ` +
        `저장소 루트에서 'npx vite-node src/samples/write-samples.ts' 로 다시 구울 수 있습니다.`,
    );
  }
  return { sequences, problems };
}
