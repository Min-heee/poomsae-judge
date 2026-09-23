"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { Comparison } from "@/follow";
import type { Landmark } from "@/judge/types";
import { DARK_THEME, drawPose, type PoseFrame, type PoseSequence, type Playback } from "@/pose";
import { drawOverlay, fitReferenceToFrame } from "./overlay";
import styles from "@/styles/studio.module.css";

/**
 * 교본 비교 한 벌. `Studio` 가 `@/follow` 를 동적으로 받아 와서 넘긴다 —
 * 오버레이를 켜지 않는 사람의 첫 화면에 비교 코어를 얹지 않으려는 것이다.
 */
export interface OverlaySource {
  /**
   * 한 프레임을 교본과 견준다. `chooseOrientation` 을 태운 결과이고,
   * `refWorld` 는 플레이어가 반대쪽으로 했으면 이미 뒤집혀 있다.
   */
  compare: (frame: PoseFrame) => { comparison: Comparison; refWorld: readonly Landmark[] } | null;
}

export interface StageProps {
  sequence: PoseSequence | null;
  frameIndex: number;
  /** 샘플 모드에서만 준다. 웹캠은 실시간이라 타임라인이 없다. */
  playback: Playback | null;
  /** 웹캠 모드에서 뒤에 깔 영상 */
  videoRef?: RefObject<HTMLVideoElement | null>;
  live?: boolean;
  mirror?: boolean;
  badge: string;
  alert?: string;
  /**
   * 교본 오버레이. **기본은 꺼짐**이라 이것을 주지 않으면 이 컴포넌트는 예전과 한 픽셀도
   * 다르게 그리지 않는다. 판정 화면은 사용자가 토글을 켤 때만 넘긴다.
   */
  overlay?: OverlaySource | null;
}

/** 교본을 내 프레임과 같은 자에 놓고 어긋남을 얹는다. 오버레이가 없으면 아무 일도 안 한다. */
function paintOverlay(
  ctx: CanvasRenderingContext2D,
  frame: PoseFrame | null,
  overlay: OverlaySource | null | undefined,
  aspect: number,
  mirror: boolean,
): void {
  if (!overlay || !frame) return;
  const got = overlay.compare(frame);
  if (!got) return;
  drawOverlay(ctx, W, H, {
    mirror,
    ghost: fitReferenceToFrame(frame, got.refWorld, aspect),
    player: frame.image,
    comparison: got.comparison,
  });
}

/** 캔버스 논리 해상도. 기기 픽셀비까지 곱해서 그린다. */
const W = 720;
const H = 540;

export function Stage({
  sequence,
  frameIndex,
  playback,
  videoRef,
  live = false,
  mirror = false,
  badge,
  alert,
  overlay = null,
}: StageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frame = sequence?.frames[frameIndex] ?? null;
  const aspect = sequence?.aspect ?? 4 / 3;

  /**
   * 라이브 루프는 프레임을 ref 로 읽는다.
   *
   * 웹캠 모드의 `frame` 은 180ms마다 새로 만들어지는 객체라, 의존성 배열에 넣으면
   * rAF 루프가 초당 대여섯 번 해제되고 다시 걸린다. 누수는 아니지만 불필요한 일이고,
   * 저전력 노트북에서는 팬이 도는 것으로 드러난다.
   */
  const frameRef = useRef(frame);
  frameRef.current = frame;
  // 오버레이 설정도 같은 이유로 ref 로 읽는다 — 켜고 끄는 것이 루프를 다시 걸 일은 아니다.
  const overlayRef = useRef({ overlay, aspect });
  overlayRef.current = { overlay, aspect };

  // 샘플 모드: 프레임이 바뀔 때만 다시 그린다.
  useEffect(() => {
    if (live) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    setupCanvas(canvas, ctx);
    drawPose(ctx, W, H, { landmarks: frame?.image ?? null, theme: DARK_THEME, mirror });
    paintOverlay(ctx, frame, overlay, aspect, mirror);
  }, [frame, live, mirror, overlay, aspect]);

  // 웹캠 모드: 영상이 매 프레임 바뀌므로 루프를 돈다.
  // `live` 는 카메라가 **실제로 켜져 있을 때만** 참이다. 웹캠 탭을 열어 두기만 해도
  // 빈 캔버스를 60fps로 계속 그리던 예전 동작을 막는다.
  useEffect(() => {
    if (!live) return;
    let raf = 0;
    let stopped = false;
    const loop = () => {
      if (stopped) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        setupCanvas(canvas, ctx);
        drawPose(ctx, W, H, {
          landmarks: frameRef.current?.image ?? null,
          video: videoRef?.current ?? null,
          theme: DARK_THEME,
          mirror,
        });
        const o = overlayRef.current;
        paintOverlay(ctx, frameRef.current, o.overlay, o.aspect, mirror);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [live, videoRef, mirror]);

  const frameCount = sequence?.frames.length ?? 0;

  return (
    <section className={styles.card} aria-label="자세 화면">
      <div className={styles.stageFrame}>
        <canvas ref={canvasRef} className={styles.stageCanvas} aria-hidden="true" />
        <span className={styles.stageBadge}>{badge}</span>
        {alert && <p className={styles.stageAlert}>{alert}</p>}
      </div>

      {playback && frameCount > 0 && (
        <div className={styles.transport}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={playback.toggle}
            aria-label={playback.playing ? "일시정지" : "재생"}
          >
            {playback.playing ? "❙❙ 정지" : "▶ 재생"}
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => playback.step(-1)}
            aria-label="이전 프레임"
          >
            ◀
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => playback.step(1)}
            aria-label="다음 프레임"
          >
            ▶
          </button>
          <input
            type="range"
            className={styles.slider}
            min={0}
            max={Math.max(frameCount - 1, 0)}
            value={frameIndex}
            onChange={(e) => playback.seekFrame(Number(e.target.value))}
            aria-label="프레임 타임라인"
          />
          <span className={styles.frameCounter}>
            {frameIndex + 1} / {frameCount} · {(playback.timeMs / 1000).toFixed(2)}초
          </span>
        </div>
      )}

      {/* 추론용 원본 영상. 화면에는 캔버스만 보인다. */}
      {videoRef && (
        <video ref={videoRef} className={styles.hiddenVideo} playsInline muted autoPlay />
      )}
    </section>
  );
}

function setupCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const targetW = Math.round(W * dpr);
  const targetH = Math.round(H * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
