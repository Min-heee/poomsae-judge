"use client";

/**
 * 웹캠 → 랜드마크 시퀀스.
 *
 * 규칙:
 *  - 권한은 **사용자가 버튼을 누를 때만** 요청한다. 페이지를 여는 것만으로는
 *    카메라를 켜지 않는다(docs/PRD.md 원칙 1).
 *  - 권한을 거부해도 앱은 계속 살아 있어야 한다. 이 훅은 에러를 문자열로 돌려줄 뿐
 *    던지지 않는다. 샘플 모드는 그대로 동작한다.
 *  - 영상은 기기 밖으로 나가지 않는다. 추론은 브라우저 안에서 끝난다.
 *  - **모델을 먼저 받고 카메라를 나중에 연다.** 순서를 뒤집으면 모델 내려받기가
 *    실패했을 때 카메라만 켜진 채로 남는다 — 쓰이지도 않는 표시등이 켜져 있는
 *    상태다. 이 순서면 실패했을 때 카메라가 켜진 적조차 없다.
 *
 * `detectForVideo` 의 타임스탬프는 단조 증가해야 한다. `video.currentTime` 을
 * ms로 바꿔 쓰면 일시정지·되감기에서 역행해 내부에서 예외가 난다. 그래서
 * `performance.now()` 를 쓰고, 같은 프레임 중복 추론만 currentTime 비교로 거른다
 * (docs/TECH-NOTES.md 3.2).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CameraView, MotionKind } from "@/judge/types";
import { createPoseEngine, type Delegate, type PoseEngine } from "./landmarker";
import type { PoseFrame, PoseSequence } from "./types";

export type WebcamStatus = "idle" | "starting" | "running" | "denied" | "error";

/** 판정에 쓸 최근 구간 길이. 이보다 오래된 프레임은 버린다. */
const WINDOW_MS = 4000;
/** 시퀀스를 다시 만드는 최소 간격. 매 프레임 새 배열을 만들면 렌더가 죽는다. */
const REBUILD_MS = 180;

export interface WebcamPose {
  status: WebcamStatus;
  /** 켜는 중인가. 버튼을 잠가 두 번 눌리는 것을 막는 데 쓴다. */
  busy: boolean;
  /** 진행 상황·실패 사유. 화면에 그대로 보여 준다. */
  message: string;
  delegate: Delegate | null;
  /** 실제 검출로 확인한 world y 축 방향. 확인 전에는 null. */
  worldYSign: 1 | -1 | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** 최근 구간으로 만든 시퀀스. 판정과 그리기 모두 이것을 본다. */
  sequence: PoseSequence | null;
  /** 이번 프레임에서 사람을 못 찾았는가 */
  noPose: boolean;
  start(): void;
  stop(): void;
}

export function useWebcamPose(motion: MotionKind, view: CameraView): WebcamPose {
  const [status, setStatus] = useState<WebcamStatus>("idle");
  const [message, setMessage] = useState("");
  const [delegate, setDelegate] = useState<Delegate | null>(null);
  const [worldYSign, setWorldYSign] = useState<1 | -1 | null>(null);
  const [sequence, setSequence] = useState<PoseSequence | null>(null);
  const [noPose, setNoPose] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<PoseEngine | null>(null);
  const bufferRef = useRef<PoseFrame[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const lastRebuildRef = useRef(0);
  const startedAtRef = useRef(0);
  const motionRef = useRef(motion);
  const viewRef = useRef(view);
  /**
   * "이미 켜져 있거나 켜는 중"을 나타낸다.
   *
   * 예전에는 이 값을 getUserMedia 와 모델 로딩이 **끝난 뒤에** 세웠다. 그 사이
   * 수 초 동안 재진입 가드가 비어 있었고, 버튼도 잠기지 않아 한 번 더 누르면
   * 두 번째 스트림이 첫 스트림을 덮어썼다 — 덮인 트랙은 아무도 끄지 않으므로
   * 카메라가 영구히 켜진 채 남는다. 그래서 start() 맨 앞에서 세우고, 실패하는
   * 모든 경로에서 되돌린다.
   */
  const runningRef = useRef(false);

  motionRef.current = motion;
  viewRef.current = view;

  const teardown = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    engineRef.current?.close();
    engineRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    bufferRef.current = [];
    lastVideoTimeRef.current = -1;
  }, []);

  useEffect(() => teardown, [teardown]);

  const stop = useCallback(() => {
    teardown();
    setStatus("idle");
    setMessage("");
    setSequence(null);
    setNoPose(false);
  }, [teardown]);

  const start = useCallback(async () => {
    // 재진입 가드. 맨 앞에서 세운다 — 아래 await 들이 수 초씩 걸린다.
    if (runningRef.current) return;
    runningRef.current = true;

    const fail = (status: WebcamStatus, text: string) => {
      teardown(); // runningRef 도 여기서 풀린다
      setStatus(status);
      setMessage(text);
    };

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      fail("error", "이 브라우저에서는 카메라를 쓸 수 없습니다. 샘플 모드는 그대로 동작합니다.");
      return;
    }

    setStatus("starting");
    setMessage("포즈 모델을 준비하는 중…");

    // 1) 모델 먼저. 여기서 실패하면 카메라는 켜진 적이 없다.
    let engine: PoseEngine;
    try {
      engine = await createPoseEngine({ onProgress: setMessage });
    } catch (err) {
      fail(
        "error",
        `포즈 모델을 불러오지 못했습니다(네트워크 확인): ${
          err instanceof Error ? err.message : String(err)
        } 샘플 모드는 그대로 동작합니다.`,
      );
      return;
    }
    if (!runningRef.current) {
      // 받는 동안 사용자가 껐거나 탭을 옮겼다. 받아 온 것을 그대로 버린다.
      engine.close();
      return;
    }
    engineRef.current = engine;

    // 2) 그다음 카메라.
    setMessage("카메라 권한을 요청하는 중…");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        fail("denied", "카메라 권한이 거부되었습니다. 샘플 모드는 그대로 쓸 수 있습니다.");
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        fail("error", "카메라를 찾지 못했습니다. 샘플 모드는 그대로 쓸 수 있습니다.");
      } else {
        fail("error", `카메라를 열지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (!runningRef.current) {
      // 권한 대화상자가 떠 있는 동안 사용자가 껐거나 탭을 옮겼다.
      // 방금 얻은 트랙을 여기서 끄지 않으면 표시등이 켜진 채 남는다.
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    // 어떤 경로로 두 번 들어와도 앞선 스트림이 새지 않게 한다.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = stream;

    const video = videoRef.current;
    if (!video) {
      fail("error", "영상 요소를 찾지 못했습니다.");
      return;
    }
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      /* 자동재생 차단은 muted+playsInline 으로 회피되지만, 실패해도 루프는 돈다 */
    }

    setDelegate(engine.delegate);
    setStatus("running");
    setMessage(`카메라 실행 중 · 추론 ${engine.delegate}`);
    startedAtRef.current = performance.now();
    bufferRef.current = [];

    const tick = () => {
      if (!runningRef.current) return;
      const v = videoRef.current;
      const eng = engineRef.current;
      if (v && eng && v.readyState >= 2 && v.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = v.currentTime;
        const now = performance.now();
        let result = null;
        try {
          result = eng.detect(v, now);
        } catch {
          // 추론 한 프레임이 실패해도 루프는 계속 돈다.
        }
        if (result) {
          setNoPose(false);
          if (eng.worldYSign !== null) setWorldYSign(eng.worldYSign);
          const t = now - startedAtRef.current;
          bufferRef.current.push({ t, image: result.image, world: result.world });
          const cutoff = t - WINDOW_MS;
          while (bufferRef.current.length > 0 && bufferRef.current[0].t < cutoff) {
            bufferRef.current.shift();
          }
          if (now - lastRebuildRef.current > REBUILD_MS && bufferRef.current.length > 4) {
            lastRebuildRef.current = now;
            const frames = bufferRef.current.slice();
            const base = frames[0].t;
            setSequence({
              id: "webcam",
              label: "웹캠 실시간",
              motion: motionRef.current,
              view: viewRef.current,
              fps: 30,
              aspect: v.videoWidth > 0 ? v.videoWidth / v.videoHeight : 4 / 3,
              frames: frames.map((f) => ({ ...f, t: f.t - base })),
              origin: "webcam",
              originNote: `웹캠 최근 ${(WINDOW_MS / 1000).toFixed(0)}초 · 카메라 각도는 사용자가 선언한 값입니다`,
            });
          }
        } else {
          setNoPose(true);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [teardown]);

  return {
    status,
    busy: status === "starting",
    message,
    delegate,
    worldYSign,
    videoRef,
    sequence,
    noPose,
    start: () => {
      void start();
    },
    stop,
  };
}
