"use client";

/**
 * 판정 화면 전체를 엮는 곳.
 *
 * 화면이 지키는 약속 세 가지:
 *  1. 기본은 **샘플 재생**이다. 페이지를 여는 것만으로는 카메라 권한을 묻지 않는다.
 *  2. 웹캠이 거부되거나 실패해도 샘플 모드는 그대로 동작한다.
 *  3. **웹캠 탭을 떠나면 카메라가 꺼진다.** "버튼을 누를 때만 켜집니다"라고 적어 둔
 *     이상, 탭을 옮기고도 표시등이 남아 있으면 그 문장이 거짓말이 된다.
 *
 * 브라우저 API는 전부 훅 안(useEffect)이나 이벤트 핸들러 안에서만 만진다.
 * 정적 내보내기에서도 이 컴포넌트가 HTML로 프리렌더되기 때문이다(docs/TECH-NOTES.md 4.4).
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ruleCoach } from "@/judge/coach";
import { REQUIRED_VIEW } from "@/judge/constants";
import type { Judgement } from "@/judge/types";
import {
  MOTION_LABEL,
  ORIGIN_LABEL,
  VIEW_LABEL,
  downloadText,
  exportSequenceText,
  importSequence,
  judgePose,
  judgementJoints,
  loadSamples,
  readFrame,
  sequenceFileName,
  usePlayback,
  useWebcamPose,
  type CameraView,
  type FrameReadout,
  type MotionKind,
  type PoseSequence,
} from "@/pose";
import { JudgePanel } from "./JudgePanel";
import { Notice } from "./Notice";
import { RuleSheet } from "./RuleSheet";
import { Stage, type OverlaySource } from "./Stage";
import styles from "@/styles/studio.module.css";

/**
 * three.js 는 첫 화면에 필요하지 않다. 3D 뷰는 판정 카드 아래에 있고, 판정 카드가
 * 먼저 떠야 한다. 따로 떼어 두면 초기 번들에서 three 가 빠진다.
 * (MediaPipe 도 같은 이유로 웹캠을 켤 때만 받는다.)
 */
/**
 * 범례도 오버레이를 켤 때만 받는다. 이 컴포넌트가 밴드 상수와 오버레이 색을 읽으므로
 * 정적으로 두면 켜지 않는 사람의 첫 화면 번들에 그 둘이 딸려 온다.
 */
const OverlayLegend = dynamic(() => import("./OverlayLegend").then((m) => m.OverlayLegend), {
  ssr: false,
  loading: () => <span className={styles.tabHint}>범례를 불러오는 중…</span>,
});

const Skeleton3D = dynamic(() => import("./Skeleton3D").then((m) => m.Skeleton3D), {
  ssr: false,
  loading: () => (
    <section className={styles.card} aria-label="3D 스켈레톤">
      <h2 className={styles.cardTitle}>3D 스켈레톤</h2>
      <p className={styles.empty}>3D 뷰를 불러오는 중…</p>
    </section>
  ),
});

type Mode = "sample" | "webcam";

const EMPTY_READOUT: FrameReadout = { frameIndex: 0, timeMs: 0, criteria: [] };

export function Studio() {
  const [mode, setMode] = useState<Mode>("sample");
  const [samples, setSamples] = useState<PoseSequence[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sampleProblems, setSampleProblems] = useState<string[]>([]);
  const [transferNote, setTransferNote] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [webcamMotion, setWebcamMotion] = useState<MotionKind>("stance");
  /**
   * 웹캠 영상의 카메라 각도는 **관측할 수 없다.** 그래서 사용자가 선언한다.
   * 선언이 규칙의 전제와 다르면 판정 코어가 H6으로 보류한다 — 화면이 마음대로
   * "측면"이라고 단정해 넣던 예전 동작은 화면이 사실과 다른 말을 하는 것이었다.
   */
  const [webcamView, setWebcamView] = useState<CameraView>(REQUIRED_VIEW.stance);
  /**
   * 교본 오버레이. **기본은 꺼짐이다** — 켜지 않으면 이 화면은 예전과 똑같이 그려진다.
   * 지도자가 "어디가 몇 도 어긋났는지"를 보고 싶을 때만 켠다.
   */
  const [overlayOn, setOverlayOn] = useState(false);
  /** `@/follow` 를 토글이 켜질 때만 받아 온다. 받기 전에는 null 이고 화면은 예전 그대로다. */
  const [follow, setFollow] = useState<typeof import("@/follow") | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const webcam = useWebcamPose(webcamMotion, webcamView);

  // 샘플은 클라이언트에서만 읽는다(fetch). 프리렌더된 HTML에는 목록이 없다.
  useEffect(() => {
    let alive = true;
    loadSamples()
      .then((res) => {
        if (!alive) return;
        setSamples(res.sequences);
        setSampleProblems(res.problems);
        setSelectedId(res.sequences[0]?.id ?? null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        // 여기까지 오는 일은 드물지만, 비면 화면이 '불러오는 중'에 영원히 박힌다.
        if (!alive) return;
        setSampleProblems([
          `샘플 목록을 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`,
        ]);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 웹캠 탭을 떠나면 카메라를 끈다.
   *
   * 훅의 정리(teardown)는 언마운트에서만 돌지만 이 컴포넌트는 계속 마운트돼 있다.
   * 탭만 바꾸면 <video> 가 사라져 추론은 아무 일도 못 하면서 트랙만 살아 있었다.
   */
  const stopWebcam = webcam.stop;
  useEffect(() => {
    if (mode !== "webcam") stopWebcam();
  }, [mode, stopWebcam]);

  // 탭을 백그라운드로 보낸 채 잊는 경우도 같이 막는다.
  useEffect(() => {
    if (mode !== "webcam") return;
    const onHidden = () => {
      if (document.visibilityState === "hidden") stopWebcam();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [mode, stopWebcam]);

  /**
   * 비교 코어는 **토글을 켤 때만** 받아 온다.
   *
   * three.js·MediaPipe 를 뗀 것과 같은 이유다 — 오버레이를 쓰지 않는 사람의 첫 화면에
   * 기준 자세 생성기와 지표 표를 얹지 않는다.
   */
  useEffect(() => {
    if (!overlayOn || follow !== null) return;
    let alive = true;
    void import("@/follow").then((m) => {
      if (alive) setFollow(m);
    });
    return () => {
      alive = false;
    };
  }, [overlayOn, follow]);

  const selected = useMemo(
    () => samples.find((s) => s.id === selectedId) ?? samples[0] ?? null,
    [samples, selectedId],
  );

  const sampleSequence = mode === "sample" ? selected : null;
  const activeSequence = mode === "sample" ? selected : webcam.sequence;

  const playback = usePlayback(sampleSequence);

  // 웹캠은 실시간이라 언제나 마지막 프레임을 본다.
  const frameIndex =
    mode === "sample"
      ? playback.frameIndex
      : Math.max((activeSequence?.frames.length ?? 1) - 1, 0);

  const readout = useMemo<FrameReadout>(
    () => (activeSequence ? readFrame(activeSequence, frameIndex) : EMPTY_READOUT),
    [activeSequence, frameIndex],
  );

  // 판정 코어가 던져도 화면은 살아 있어야 한다. 사유는 그대로 띠로 보여 준다.
  // 던지는 경우는 구조가 깨진 입력뿐이고, 데이터 품질 문제는 보류로 돌아온다.
  const outcome = useMemo<{ judgement: Judgement | null; error: string | null }>(() => {
    if (!activeSequence) return { judgement: null, error: null };
    try {
      return { judgement: judgePose(activeSequence), error: null };
    } catch (err) {
      return { judgement: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [activeSequence]);

  // 코칭 문장은 판정에서만 나온다. 키도 네트워크도 쓰지 않는 규칙 기반이라
  // 판정과 같은 순간에 같은 값으로 계산된다(src/judge/coach.ts).
  const advice = useMemo(
    () => (outcome.judgement ? ruleCoach(outcome.judgement) : null),
    [outcome.judgement],
  );

  // 3D 뷰가 "판정이 어디를 봤는지" 칠할 수 있게 관절 번호를 넘긴다.
  const flaggedJoints = useMemo(() => judgementJoints(outcome.judgement), [outcome.judgement]);

  const handleSeek = useCallback(
    (index: number) => {
      if (mode === "sample") playback.seekFrame(index);
    },
    [mode, playback],
  );

  /** F6 — 지금 보고 있는 시퀀스를 샘플 파일과 같은 형식으로 내려받는다. */
  const handleExport = useCallback(() => {
    if (!activeSequence) return;
    setTransferError(null);
    const name = sequenceFileName(activeSequence);
    try {
      downloadText(name, exportSequenceText(activeSequence));
      setTransferNote(
        `${name} 을(를) 내려받았습니다. 옆의 '불러오기'로 다시 넣으면 같은 점수가 나옵니다.`,
      );
    } catch (err) {
      setTransferError(`내보내지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [activeSequence]);

  /** F6 — 내보낸(또는 밖에서 만든) JSON 을 샘플 목록에 넣는다. */
  const handleImport = useCallback(async (file: File) => {
    setTransferNote(null);
    setTransferError(null);
    try {
      const seq = await importSequence(file);
      setSamples((prev) => [seq, ...prev.filter((s) => s.id !== seq.id)]);
      setSelectedId(seq.id);
      setMode("sample");
      setTransferNote(`${file.name} 을(를) 불러왔습니다. 목록 맨 앞에 넣었습니다.`);
    } catch (err) {
      setTransferError(
        `${file.name} 을(를) 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, []);

  const motion: MotionKind = activeSequence?.motion ?? (mode === "webcam" ? webcamMotion : "stance");
  const currentFrame = activeSequence?.frames[frameIndex]?.world ?? null;

  /**
   * 교본은 새 에셋이 아니라 **코드로 생성한 기준 자세**다(`src/samples/reference-frames.ts`).
   * 어느 관절이 얼마나 어긋났는지는 비교 코어가 정한다 — 화면은 색만 칠한다.
   */
  const overlay = useMemo<OverlaySource | null>(() => {
    if (!overlayOn || follow === null) return null;
    const pose = follow.referencePose(motion === "stance" ? "juchum" : "ap-chagi-apex");
    return {
      compare: (frame) => {
        const choice = follow.chooseOrientation(pose, frame.world);
        return {
          comparison: choice.comparison,
          refWorld: choice.mirrored ? follow.mirrorFrame(pose.frame) : pose.frame,
        };
      },
    };
  }, [follow, motion, overlayOn]);

  // 각도는 관측값이 아니라 선언이다. 뱃지도 그렇게 적는다.
  const badge = activeSequence
    ? `${MOTION_LABEL[activeSequence.motion]} · ${VIEW_LABEL[activeSequence.view]} 전제 · ${
        ORIGIN_LABEL[activeSequence.origin]
      }`
    : mode === "webcam"
      ? "웹캠 대기"
      : "불러오는 중";

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.title}>품새 판정기</h1>
        <Link href="/game/" style={{ fontSize: 13, fontWeight: 600 }}>
          따라하기 게임 →
        </Link>
      </header>
      <p className={styles.subtitle}>
        브라우저에서 관절 33개를 읽어 태권도 기본 동작을 공개된 규칙으로 채점하고, 그 근거를 그대로
        보여 주는 데모입니다. 점수 옆에는 언제나 측정값과 경계값이 함께 있습니다. 카메라 없이
        샘플만으로 전부 확인할 수 있습니다.
      </p>

      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label="입력 모드">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "sample"}
            className={`${styles.tab} ${mode === "sample" ? styles.tabActive : ""}`}
            onClick={() => setMode("sample")}
          >
            샘플 재생
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "webcam"}
            className={`${styles.tab} ${mode === "webcam" ? styles.tabActive : ""}`}
            onClick={() => setMode("webcam")}
          >
            웹캠 (선택)
          </button>
        </div>
        <span className={styles.tabHint}>
          {mode === "sample"
            ? "코드로 합성한 랜드마크 시퀀스를 재생합니다. 촬영본이 아니고, 카메라 권한도 묻지 않습니다."
            : "버튼을 눌러야 권한을 요청합니다. 영상은 기기 밖으로 나가지 않습니다."}
        </span>
      </div>

      {mode === "sample" ? (
        <>
          {loading && <Notice tag="불러오는 중">샘플 시퀀스를 읽고 있습니다.</Notice>}
          {!loading && samples.length === 0 && (
            <Notice tone="warn" tag="샘플 없음">
              읽을 수 있는 샘플이 없습니다. 아래 &lsquo;JSON 불러오기&rsquo;로 시퀀스 파일을 직접
              넣거나, 저장소 루트에서 <code>npx vite-node src/samples/write-samples.ts</code> 로
              샘플을 다시 구울 수 있습니다.
            </Notice>
          )}
          {sampleProblems.map((p) => (
            <Notice key={p} tone="bad" tag="샘플 형식 오류">
              {p}
            </Notice>
          ))}

          <div className={styles.samples} role="group" aria-label="샘플 목록">
            {samples.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`${styles.sample} ${s.id === selected?.id ? styles.sampleActive : ""}`}
                aria-pressed={s.id === selected?.id}
                onClick={() => setSelectedId(s.id)}
              >
                <span className={styles.sampleMotion}>{MOTION_LABEL[s.motion]}</span>
                {s.label}
              </button>
            ))}
          </div>

          {selected?.note && <p className={styles.subtitle}>{selected.note}</p>}
          {/* 이 시퀀스가 어떻게 만들어졌는지는 파일이 스스로 적어 온다. 그대로 보인다. */}
          {selected?.originNote && <p className={styles.tabHint}>출처: {selected.originNote}</p>}
        </>
      ) : (
        <>
          <div className={styles.toolbar}>
            <div className={styles.tabs} role="group" aria-label="채점할 동작">
              {(["stance", "frontKick"] as MotionKind[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`${styles.tab} ${webcamMotion === m ? styles.tabActive : ""}`}
                  aria-pressed={webcamMotion === m}
                  onClick={() => {
                    setWebcamMotion(m);
                    setWebcamView(REQUIRED_VIEW[m]);
                  }}
                >
                  {MOTION_LABEL[m]}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={styles.rulesToggle}
              disabled={webcam.busy}
              onClick={webcam.status === "running" ? webcam.stop : webcam.start}
            >
              {webcam.busy
                ? "여는 중…"
                : webcam.status === "running"
                  ? "카메라 끄기"
                  : "카메라 켜기"}
            </button>
          </div>

          <div className={styles.toolbar}>
            <div className={styles.tabs} role="group" aria-label="카메라 각도 선언">
              {(["frontal", "sagittal"] as CameraView[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`${styles.tab} ${webcamView === v ? styles.tabActive : ""}`}
                  aria-pressed={webcamView === v}
                  onClick={() => setWebcamView(v)}
                >
                  {VIEW_LABEL[v]}에서 촬영
                </button>
              ))}
            </div>
            <span className={styles.tabHint}>
              카메라 각도는 관절 좌표로 관측할 수 없어 직접 선언합니다. 규칙의 전제(
              {MOTION_LABEL[webcamMotion]} = {VIEW_LABEL[REQUIRED_VIEW[webcamMotion]]})와 다르면
              채점하지 않고 H6으로 보류합니다.
            </span>
          </div>

          {webcam.status === "denied" && (
            <Notice tone="warn" tag="권한 거부">
              {webcam.message} 위 탭에서 &lsquo;샘플 재생&rsquo;으로 돌아가면 모든 기능을 그대로 볼 수
              있습니다.
            </Notice>
          )}
          {webcam.status === "error" && (
            <Notice tone="bad" tag="카메라 오류">
              {webcam.message}
            </Notice>
          )}
          {(webcam.status === "starting" || webcam.status === "running") && (
            <Notice tag="웹캠">
              {webcam.message}
              {webcam.worldYSign !== null &&
                ` · world y축 실측 확인: ${webcam.worldYSign === 1 ? "아래로 증가" : "위로 증가(뒤집어 사용)"}`}
            </Notice>
          )}
          {webcam.status === "idle" && (
            <Notice tag="웹캠">
              카메라는 이 버튼을 누를 때만 켜지고, 이 탭을 떠나면 꺼집니다. 추론은 브라우저 안에서
              끝나고, 영상도 좌표도 서버로 보내지 않습니다. 모델 약 5.5MB를 먼저 내려받은 뒤에 권한을
              묻습니다.
            </Notice>
          )}
        </>
      )}

      {/* F6 — 내보내기·불러오기. 웹캠으로 찍은 것을 샘플로 되먹이는 고리다. */}
      <div className={styles.toolbar}>
        <div className={styles.tabs} role="group" aria-label="시퀀스 파일">
          <button
            type="button"
            className={styles.tab}
            disabled={!activeSequence}
            onClick={handleExport}
          >
            시퀀스 JSON 내보내기
          </button>
          <button type="button" className={styles.tab} onClick={() => fileInputRef.current?.click()}>
            JSON 불러오기
          </button>
        </div>
        <span className={styles.tabHint}>
          내보낸 파일은 <code>public/samples/</code> 의 것과 같은 형식입니다. 다시 불러오면 같은
          점수가 나옵니다 — 왕복이 판정을 바꾸지 않는다는 것은 테스트가 샘플 전부에 대해 확인합니다.
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className={styles.hiddenVideo}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = ""; // 같은 파일을 다시 골라도 change 가 뜨게
            if (f) void handleImport(f);
          }}
        />
      </div>

      {transferNote && <Notice tag="시퀀스 파일">{transferNote}</Notice>}
      {transferError && (
        <Notice tone="bad" tag="시퀀스 파일">
          {transferError}
        </Notice>
      )}

      {outcome.error && (
        <Notice tone="bad" tag="판정 코어 오류">
          {outcome.error}
        </Notice>
      )}

      {/* 교본 오버레이 — 기본은 꺼짐. 켜지 않으면 이 화면은 예전 그대로다. */}
      <div className={styles.toolbar}>
        <div className={styles.tabs} role="group" aria-label="교본 오버레이">
          <button
            type="button"
            className={`${styles.tab} ${overlayOn ? styles.tabActive : ""}`}
            aria-pressed={overlayOn}
            onClick={() => setOverlayOn((v) => !v)}
          >
            교본 겹쳐 보기 {overlayOn ? "켬" : "끔"}
          </button>
        </div>
        <span className={styles.tabHint}>
          기준 자세를 내 스켈레톤 위에 겹치고, 교본과 어긋난 관절을 자홍 실선으로 칠해 차이를
          숫자로 붙입니다. 표시 문턱은 <strong>표시 전용</strong>이라 감점을 만들지 않습니다 —
          점수는 지금처럼 판정 규칙에서만 나옵니다. 경계값은 아래 범례에 있습니다.
        </span>
      </div>

      {overlayOn && (
        <div className={styles.toolbar} style={{ gap: 16, justifyContent: "flex-start" }}>
          <OverlayLegend motion={motion} />
        </div>
      )}

      <div className={styles.main}>
        <div style={{ display: "grid", gap: 16 }}>
          <Stage
            sequence={activeSequence}
            frameIndex={frameIndex}
            playback={mode === "sample" ? playback : null}
            videoRef={mode === "webcam" ? webcam.videoRef : undefined}
            live={mode === "webcam" && webcam.status === "running"}
            mirror={mode === "webcam"}
            overlay={overlay}
            badge={badge}
            alert={
              mode === "webcam" && webcam.status === "running" && webcam.noPose
                ? "사람을 찾지 못했습니다. 카메라에서 2~3m 떨어져 전신이 들어오게 서 주세요."
                : readout.invalid
            }
          />
          <Skeleton3D frame={currentFrame} highlight={flaggedJoints} />
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          <JudgePanel
            motion={motion}
            judgement={outcome.judgement}
            advice={advice}
            readout={readout}
            frameCount={activeSequence?.frames.length ?? 0}
            onSeekFrame={handleSeek}
          />
          <RuleSheet motion={motion} />
        </div>
      </div>

      <footer className={styles.footer}>
        <p>
          이 판정 규칙은 유단자·심판의 검토를 받지 않았습니다. 자체 감점값이며 어떤 연맹의 공식
          채점표도 재현하지 않습니다. 실제 대회 채점을 대체할 수 없습니다.
        </p>
        <p>
          단일 카메라의 깊이(z)는 상대값이라, 깊이에 의존하는 판정은 넣지 않았습니다. 그래서 규칙마다
          카메라 각도를 전제합니다. 표현성(강유·완급·리듬·기합)은 규칙으로 닫을 수 있는 영역이
          아니라고 보아 아예 채점하지 않습니다.
        </p>
      </footer>
    </div>
  );
}
