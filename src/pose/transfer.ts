/**
 * 시퀀스 JSON 내보내기·불러오기 (PRD F6).
 *
 * 이 고리가 닫혀 있어야 "웹캠으로 찍은 것을 샘플로 되먹인다"가 말이 아니라
 * 동작이 된다. 내보낸 파일은 `public/samples/*.json` 과 **같은 형식**이다 —
 * 형식이 둘이면 되먹인 파일이 다른 경로로 파싱되고, 그 순간 같은 점수가
 * 나온다는 보장이 사라진다.
 *
 * 왕복이 판정을 바꾸지 않는다는 것은 `src/pose/integration.test.ts` 의
 * "F6 — 내보내고 다시 읽어도 같은 판정"이 샘플 7개 전부에 대해 확인한다.
 *
 * 브라우저 API(`Blob`·`URL`·`FileReader`)는 전부 함수 **안**에서만 만진다.
 * 모듈 최상단에서 건드리면 정적 내보내기의 프리렌더가 깨진다.
 */

import { encodeSequence, stringifySampleFile } from "@/samples/codec";
import { normalizeSequence, SequenceFormatError } from "./sequence";
import { toLandmarkSequence, type PoseSequence } from "./types";

/** 내보낼 파일 이름. 같은 시퀀스를 여러 번 내보내도 이름이 흔들리지 않는다. */
export function sequenceFileName(seq: PoseSequence): string {
  const safe = seq.id.replace(/[^a-zA-Z0-9._-]/g, "-");
  return `${safe || "sequence"}.json`;
}

/**
 * 시퀀스를 파일 텍스트로. 순수 함수라 테스트에서 그대로 부를 수 있다.
 *
 * `toLandmarkSequence` 를 지나므로 **그리기용 image 좌표는 버려진다.**
 * 내보내는 것은 판정의 입력, 곧 world 랜드마크뿐이다(PRD 6절).
 * 좌표는 codec 이 0.1mm 로 반올림해 고정한다 — 부동소수점 끝자리가 흔들리면
 * 같은 동작을 두 번 내보낼 때 파일이 달라진다.
 */
export function exportSequenceText(seq: PoseSequence): string {
  return stringifySampleFile(encodeSequence(toLandmarkSequence(seq), seq.note));
}

/**
 * 파일 하나를 읽어 시퀀스로. 실패하면 이유를 담아 던진다.
 *
 * 읽기는 느슨한 파서(`normalizeSequence`)를 지난다 — 밖에서 만든 파일도 받되,
 * 신뢰도가 없거나 칸 순서가 다르면 거부한다. 거부 사유는 화면에 그대로 뜬다.
 */
export async function importSequence(file: File): Promise<PoseSequence> {
  const text = await file.text();

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SequenceFormatError(`${file.name}: JSON 으로 읽을 수 없습니다.`);
  }

  const id = file.name.replace(/\.json$/i, "") || "imported";
  return normalizeSequence(raw, { id, origin: "imported" });
}

/**
 * 텍스트를 사용자의 디스크로 내려보낸다.
 *
 * 네트워크를 타지 않는다 — Blob 은 메모리에서 만들어지고 `revokeObjectURL` 로
 * 바로 회수한다. 웹캠으로 찍은 좌표가 서버로 나가지 않는다는 약속이
 * 내보내기 경로에서도 그대로 지켜져야 한다.
 */
export function downloadText(fileName: string, text: string): void {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
