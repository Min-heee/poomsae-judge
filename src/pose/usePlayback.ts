"use client";

/**
 * 샘플 시퀀스 재생 시계.
 *
 * 시간의 기준은 `frame.t` 하나다. 브라우저 프레임률이 흔들려도 재생 위치가
 * 시퀀스 시간과 어긋나지 않는다. 타임라인을 끌면 재생이 멈추고 그 프레임에 선다 —
 * 판정 근거를 읽는 중에 화면이 계속 흘러가면 읽을 수가 없다.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { frameIndexAt, sequenceDurationMs, type PoseSequence } from "./types";

export interface Playback {
  frameIndex: number;
  timeMs: number;
  durationMs: number;
  playing: boolean;
  play(): void;
  pause(): void;
  toggle(): void;
  /** 프레임 번호로 이동. 재생 중이면 멈춘다. */
  seekFrame(index: number): void;
  step(delta: number): void;
}

export function usePlayback(seq: PoseSequence | null, autoPlay = true): Playback {
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);

  const offsetRef = useRef(0);
  const startedAtRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const durationMs = seq ? sequenceDurationMs(seq) : 0;
  const frameCount = seq?.frames.length ?? 0;

  // 시퀀스가 바뀌면 처음으로 되돌린다.
  useEffect(() => {
    offsetRef.current = 0;
    startedAtRef.current = 0;
    setFrameIndex(0);
    setPlaying(autoPlay);
  }, [seq, autoPlay]);

  useEffect(() => {
    if (!seq || !playing || frameCount === 0 || durationMs <= 0) return;

    startedAtRef.current = performance.now();
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const elapsed = performance.now() - startedAtRef.current;
      let t = offsetRef.current + elapsed;
      if (t > durationMs) {
        // 끝나면 처음으로 돌아간다. 심사위원이 다시 누를 필요가 없게.
        t = 0;
        offsetRef.current = 0;
        startedAtRef.current = performance.now();
      }
      setFrameIndex(frameIndexAt(seq, t));
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [seq, playing, durationMs, frameCount]);

  const seekFrame = useCallback(
    (index: number) => {
      if (!seq || seq.frames.length === 0) return;
      const i = Math.min(Math.max(index, 0), seq.frames.length - 1);
      offsetRef.current = seq.frames[i].t - seq.frames[0].t;
      startedAtRef.current = performance.now();
      setFrameIndex(i);
      setPlaying(false);
    },
    [seq],
  );

  const step = useCallback(
    (delta: number) => {
      setPlaying(false);
      setFrameIndex((prev) => {
        if (!seq || seq.frames.length === 0) return prev;
        const next = Math.min(Math.max(prev + delta, 0), seq.frames.length - 1);
        offsetRef.current = seq.frames[next].t - seq.frames[0].t;
        startedAtRef.current = performance.now();
        return next;
      });
    },
    [seq],
  );

  const play = useCallback(() => setPlaying(true), []);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => setPlaying((v) => !v), []);

  const timeMs = seq && seq.frames[frameIndex] ? seq.frames[frameIndex].t - seq.frames[0].t : 0;

  return { frameIndex, timeMs, durationMs, playing, play, pause, toggle, seekFrame, step };
}
