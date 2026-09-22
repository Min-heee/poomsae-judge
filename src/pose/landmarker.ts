/**
 * MediaPipe PoseLandmarker 초기화와 프레임 추론.
 *
 * 이 모듈은 **웹캠 모드에서만** 불린다. 샘플 모드는 모델도 WASM도 받지 않는다 —
 * 링크를 연 심사위원에게 5.5MB 모델을 내려보낼 이유가 없다. 그래서
 * `@mediapipe/tasks-vision` 은 top-level import 하지 않고 동적 import 한다
 * (docs/TECH-NOTES.md 3.5).
 *
 * 브라우저 전용이다. 모듈 최상단에서 window·navigator 를 만지지 않으므로
 * 정적 내보내기의 프리렌더에서 깨지지 않는다.
 */

import type { Landmark } from "@/judge/types";
import { LM } from "@/judge/landmarks";

/** package.json 의 @mediapipe/tasks-vision 과 **반드시** 같아야 한다. */
export const MP_VERSION = "1.0.1";

/** @latest 를 쓰지 않는다. 결정성 원칙에 어긋나고 어느 날 조용히 깨진다. */
export const MP_WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
export const MP_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/" +
  "pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export type Delegate = "GPU" | "CPU";

export interface DetectResult {
  /** 0~1 정규화 이미지 좌표 (그리기용) */
  image: Landmark[];
  /** 판정 좌표 — y가 아래로 증가하도록 맞춘 것 */
  world: Landmark[];
}

export interface PoseEngine {
  delegate: Delegate;
  /** y 부호를 실제 검출로 확인했는가. 확인 전에는 null. */
  worldYSign: 1 | -1 | null;
  detect(video: HTMLVideoElement, timestampMs: number): DetectResult | null;
  close(): void;
}

interface RawLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

function toLandmarks(raw: readonly RawLandmark[], ySign: number): Landmark[] {
  return raw.map((lm) => ({
    x: lm.x,
    y: lm.y * ySign,
    z: lm.z,
    visibility: lm.visibility,
  }));
}

/**
 * world 좌표의 y가 어느 쪽으로 증가하는지 실제 검출에서 확인한다.
 *
 * docs/TECH-NOTES.md 11절이 "빈 이미지로는 확인할 수 없다"고 남겨 둔 항목이다.
 * 추측해서 상수로 박는 대신, 첫 검출에서 코와 발목의 y를 비교해 정한다.
 * 코가 발목보다 작은 y를 가지면 이미 "아래로 증가"하는 좌표계다.
 */
function detectYSign(raw: readonly RawLandmark[]): 1 | -1 | null {
  const nose = raw[LM.nose];
  const ankleL = raw[LM.leftAnkle];
  const ankleR = raw[LM.rightAnkle];
  if (!nose || !ankleL || !ankleR) return null;
  if (nose.visibility < 0.5 || Math.max(ankleL.visibility, ankleR.visibility) < 0.5) return null;
  const ankleY = (ankleL.y + ankleR.y) / 2;
  if (Math.abs(ankleY - nose.y) < 0.2) return null; // 너무 가까우면 판단 보류
  return nose.y < ankleY ? 1 : -1;
}

export interface CreateOptions {
  /** 단계별 진행 상황을 화면에 흘려보내기 위한 콜백 */
  onProgress?: (message: string) => void;
  /** 각 내려받기 단계의 제한 시간(ms). 0 이하면 제한 없음. */
  timeoutMs?: number;
}

/**
 * CDN 두 곳이 이 앱의 유일한 외부 의존이고, 심사 환경의 네트워크는 통제할 수 없다.
 *
 * 프록시가 RST 없이 연결을 삼키면 `await` 는 **영원히** 걸린다. 그 상태에서는
 * 화면이 "모델을 받는 중…"에 멈춘 채 빠져나갈 길이 없다. 그래서 단계마다
 * 제한 시간을 걸고, 만료되면 실패로 떨어뜨린다 — 실패는 복구 가능하지만
 * 영원한 대기는 복구할 수 없다.
 */
export const DEFAULT_TIMEOUT_MS = 25_000;

class LoadTimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what}을(를) ${(ms / 1000).toFixed(0)}초 안에 받지 못했습니다.`);
    this.name = "LoadTimeoutError";
  }
}

/**
 * `onLate` 는 제한 시간이 지난 **뒤에** 원래 약속이 성공했을 때 불린다.
 * 그 결과물을 아무도 들고 있지 않으므로 여기서 버려 주지 않으면
 * WASM/GPU 자원이 그대로 남는다.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  what: string,
  onLate?: (value: T) => void,
): Promise<T> {
  if (ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new LoadTimeoutError(what, ms));
    }, ms);
    promise.then(
      (v) => {
        if (settled) {
          onLate?.(v);
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e as Error);
      },
    );
  });
}

/**
 * PoseLandmarker 를 만든다. GPU 위임이 실패하면 CPU로 한 번 더 시도한다
 * (구형 GPU·일부 리눅스 브라우저에서 GPU 경로가 죽는다 — TECH-NOTES 7절 10번).
 */
export async function createPoseEngine(opts: CreateOptions = {}): Promise<PoseEngine> {
  const progress = opts.onProgress ?? (() => {});
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  progress("포즈 모듈을 불러오는 중…");
  const { FilesetResolver, PoseLandmarker } = await withTimeout(
    import("@mediapipe/tasks-vision"),
    timeout,
    "포즈 모듈",
  );

  progress("런타임(WASM)을 받는 중…");
  const vision = await withTimeout(
    FilesetResolver.forVisionTasks(MP_WASM_BASE),
    timeout,
    "WASM 런타임",
  );

  const build = async (delegate: Delegate) => {
    progress(`모델을 받는 중… (${delegate})`);
    return withTimeout(
      PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MP_MODEL_URL, delegate },
        runningMode: "VIDEO",
        numPoses: 1,
      }),
      timeout,
      "포즈 모델",
      // 늦게 도착한 모델은 아무도 쓰지 않는다. 여기서 닫지 않으면 남는다.
      (late) => late.close(),
    );
  };

  let delegate: Delegate = "GPU";
  let landmarker: Awaited<ReturnType<typeof build>>;
  try {
    landmarker = await build("GPU");
  } catch (err) {
    // 제한 시간 만료는 재시도해도 같은 결과다. CPU 폴백은 GPU 위임이 거부된
    // 경우(구형 GPU·일부 리눅스 브라우저)에만 의미가 있다.
    if (err instanceof LoadTimeoutError) throw err;
    progress("GPU 위임에 실패했습니다. CPU로 다시 시도합니다…");
    delegate = "CPU";
    landmarker = await build("CPU");
  }

  progress("준비 완료");

  let ySign: 1 | -1 | null = null;
  let closed = false;

  return {
    delegate,
    get worldYSign() {
      return ySign;
    },
    detect(video, timestampMs) {
      if (closed) return null;
      const res = landmarker.detectForVideo(video, timestampMs);
      const image = res.landmarks?.[0];
      const world = res.worldLandmarks?.[0];
      // 미검출이면 landmarks 는 빈 배열이고 [0] 은 undefined 다.
      if (!image || !world) return null;
      if (ySign === null) ySign = detectYSign(world);
      return {
        image: toLandmarks(image, 1),
        world: toLandmarks(world, ySign ?? 1),
      };
    },
    close() {
      closed = true;
      landmarker.close();
    },
  };
}
