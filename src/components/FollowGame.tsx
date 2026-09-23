"use client";

/**
 * 따라하기 게임 — 제시 → 준비 → 맞추기 → 판정 → 다음.
 *
 * 이 파일은 **화면**이다. 점수도 각도도 여기서 계산하지 않는다 —
 * 판정은 `@/judge`, 창 선택과 점수 산식은 `@/follow`, 카드 그리기는 `@/card` 가 한다.
 * 여기 있는 것은 시계, 기록기, 캔버스, 그리고 손맛뿐이다.
 *
 * 화면이 지키는 약속 넷.
 *
 * 1. **기본은 시연 모드다.** 심사위원에게 카메라가 없을 수 있으므로 이미 커밋된 합성
 *    샘플을 플레이어 입력 자리에 흘려보내 **같은 코드 경로**로 루프를 돌린다.
 *    웹캠은 사용자가 켤 때만 켜진다.
 * 2. **기록기는 시작 신호에서 연다.** 카운트다운 동안의 준비 자세는 기록기에 들어갈 경로가
 *    없다 — 웹캠 훅의 4초 링버퍼를 그대로 쓰지 않고, 시작 신호 이후의 프레임만 담아
 *    `judgeRound` 에 넘긴다. 그 함수는 t = 0 이 시작 신호가 아니면 던진다.
 *    **시각은 두 모드 모두 같은 축 위에 있다** — 시연은 예정 시각, 웹캠은 배치가 싣고 온
 *    `epochMs`. 배치를 받은 시각으로 되짚던 예전 방식은 배치 지연만큼 모든 프레임을 뒤로
 *    밀어, 시작 직전의 준비 자세를 기록 안으로 끌어들였다(아래 어댑터 주석).
 * 3. **시계는 하나.** rAF 가 주는 `timestamp` 만 본다. 프레임을 세지 않는다 — 메인 스레드가
 *    1.5초 막히면 프레임 카운트는 없는 1.49초를 화면에 남긴다(실측).
 * 4. **맞추기 단계에서 메인 스레드를 120ms 넘게 잡지 않는다.** 성능이 아니라 정확성
 *    문제다 — 넘기면 H3으로 그 라운드가 점수 대신 보류가 된다. 그래서 카드 인코딩은
 *    라운드가 다 끝난 뒤에만 하고, 시작 버튼에서 인코더를 미리 깨워 둔다.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cardInputFromJudgement,
  canvasToPngBlob,
  cardFileName,
  createCardCanvas,
  downloadBlob,
  previewUrl,
  renderCard,
  sanitizeCardData,
  shareOrDownloadCard,
  warmUpPngEncoder,
  type CardInput,
  type CardPoint,
} from "@/card";
import {
  COURSES,
  PHASE_SECONDS,
  STAR_THRESHOLDS,
  SUCCESS_BASE_SCORE,
  chooseOrientation,
  comboMultiplier,
  course as courseById,
  demoTickTimes,
  judgeRound,
  mirrorFrame,
  referencePose,
  summarizeCourse,
  type Comparison,
  type Course,
  type CourseId,
  type CourseSummary,
  type GameRound,
  type MetricComparison,
  type ReferencePose,
  type RoundResult,
} from "@/follow";
import type { CameraView, Landmark, MotionKind, TimedFrame } from "@/judge/types";
import {
  DARK_THEME,
  MOTION_LABEL,
  VIEW_LABEL,
  drawPose,
  loadSamples,
  useWebcamPose,
  type PoseFrame,
  type PoseSequence,
} from "@/pose";
import { EffectLayer, drawHud, type GamePhase, type HudState } from "./gameDraw";
import { Notice } from "./Notice";
import { OverlayLegend } from "./OverlayLegend";
import {
  drawOverlay,
  fitReferenceStandalone,
  fitReferenceToFrame,
  metricDeltaText,
} from "./overlay";
import styles from "./game.module.css";

/** 캔버스 논리 해상도. `Stage` 와 같은 값을 쓴다. */
const W = 720;
const H = 540;

/**
 * 이 폭(캔버스의 CSS 폭, px) 아래에서는 캔버스 위 숫자 라벨을 접는다.
 *
 * 375px 기기에서 캔버스 CSS 폭은 341px 인데 논리 폭이 720px 이라 배율이 0.47 이다.
 * 15px 라벨이 7 CSS px 로 렌더돼 읽히지 않고, 라벨끼리 겹쳐 스켈레톤 위에 얼룩만 남는다.
 * 같은 숫자는 바로 아래 곁 표에 큰 글씨로 다시 나오므로 정보는 잃지 않는다.
 */
const NARROW_CANVAS_PX = 480;

/** 곁 패널을 새로 그리는 간격. 매 프레임 React 상태를 흔들지 않는다. */
const PANEL_REFRESH_MS = 220;

/**
 * '우수' 문턱. **별 셋의 문턱과 같은 값**을 쓰고, 90을 손으로 적지 않는다.
 * 문턱을 조정하는 날 화면의 색만 옛 기준으로 남는 일을 막는다.
 */
const EXCELLENT_BASE_SCORE = STAR_THRESHOLDS[STAR_THRESHOLDS.length - 1];

const PRESENT_MS = PHASE_SECONDS.present * 1000;
const READY_MS = PHASE_SECONDS.ready * 1000;
const FEEDBACK_MS = PHASE_SECONDS.feedback * 1000;

type Mode = "demo" | "webcam";

/** 사용자가 선언할 수 있는 카메라 각도. 규칙이 전제하는 두 가지가 전부다. */
const VIEW_CHOICES: readonly CameraView[] = ["frontal", "sagittal"];

/**
 * 카드에 박을 날짜 — **보는 사람의 달력 날짜**다.
 *
 * `toISOString()` 은 UTC 라 한국에서는 자정부터 오전 9시까지 **어제 날짜**를 찍는다.
 * 인증서처럼 생긴 카드에 적히는 몇 안 되는 사실 중 하나가 날짜이고, 파일 이름
 * (`poomsae-20260924-…`)도 이 값에서 나온다. 화면이 거짓말을 하지 않는다는 원칙이
 * 시계에도 걸린다 — 그래서 UTC 가 아니라 지역 날짜를 넘긴다.
 *
 * 카드 층은 여전히 시계를 읽지 않는다(`src/card/purity.test.ts` 가 막는다).
 * 날짜를 정하는 것은 호출자의 몫이고, 그 몫이 여기다.
 */
function localDateISO(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 제시 단계에 띄우는 한 줄. 화면 문구라 이 층에 둔다(판정에도 비교에도 쓰이지 않는다). */
const CUE: Record<MotionKind, string> = {
  stance: "발을 어깨너비 두 배로 벌리고, 앉듯이 무릎을 굽혀 멈추세요.",
  frontKick: "무릎을 먼저 들고, 발끝을 앞으로 곧게 뻗었다가 다시 접으세요.",
};

/** 한 라운드가 끝난 뒤 화면이 기억해 두는 것. */
interface RoundView {
  result: RoundResult;
  /** 판정에 넘긴 것과 **같은 순서의** 그리기 프레임. `window.fromIndex/toIndex` 가 이 배열을 가리킨다. */
  frames: readonly PoseFrame[];
  /** 되감기로 보여 줄 구간 — 게임의 2초 창이 아니라 **판정이 실제로 읽은 구간**이다. */
  replay: readonly PoseFrame[];
  /** 카드에 박을 대표 프레임 */
  hero: PoseFrame | null;
}

interface LoopState {
  phase: GamePhase;
  phaseStart: number;
  lastTs: number;
  rounds: readonly GameRound[];
  roundIndex: number;
  views: RoundView[];
  combo: number;
  /** 시작 신호 이후의 프레임만 들어온다. t는 시작 신호 기준 ms. */
  record: PoseFrame[];
  captureStart: number;
  demoFrames: readonly PoseFrame[] | null;
  demoNextT: number;
  demoK: number;
  demoDt: number;
  /** 웹캠 프레임 중복 방지. 훅이 배치를 다시 만들어도 좌표 배열의 신원은 유지된다. */
  seen: WeakSet<object>;
  lastView: RoundView | null;
  lastPanelPush: number;
  /**
   * 탭을 벗어난 동안인가. 참이면 단계 기계를 돌리지 않는다 —
   * rAF 가 멈춘 사이에 시계만 흘러가서, 돌아온 첫 틱이 한 단계를 통째로 건너뛰거나
   * 빈 기록으로 라운드를 끝내 버리는 것을 막는다.
   */
  suspended: boolean;
}

const emptyLoop = (): LoopState => ({
  phase: "idle",
  phaseStart: 0,
  lastTs: 0,
  rounds: [],
  roundIndex: 0,
  views: [],
  combo: 0,
  record: [],
  captureStart: 0,
  demoFrames: null,
  demoNextT: 0,
  demoK: 0,
  demoDt: 1000 / 30,
  seen: new WeakSet<object>(),
  lastView: null,
  lastPanelPush: 0,
  suspended: false,
});

export function FollowGame() {
  const [mode, setMode] = useState<Mode>("demo");
  const [courseId, setCourseId] = useState<CourseId>("frontal");
  /**
   * 웹캠 모드에서 **사용자가 선언하는** 카메라 각도.
   *
   * 각도는 화면이 관측할 수 없으므로 시퀀스가 선언하고, 규칙의 전제와 다르면 H6으로
   * 보류한다. 판정 화면에는 그 선택기가 있는데 게임에는 없었다 — 그러면서 화면은
   * "각도가 다르면 H6으로 보류합니다"라고 약속하고 있었다. 게임이 언제나 코스의 각도를
   * 그대로 넘기니 H6 은 **구조적으로 발화할 수 없는 약속**이었고, 앞차기 코스를 정면으로
   * 서서 한 사람은 보류가 아니라 측면 산식으로 계산된 **틀린 점수**를 받았다.
   * 문장을 약하게 고치는 대신 선택기를 만들어 약속을 참으로 만든다.
   */
  const [declaredView, setDeclaredView] = useState<CameraView>("frontal");
  const [samples, setSamples] = useState<PoseSequence[]>([]);
  const [loadNote, setLoadNote] = useState<string | null>(null);

  const [phase, setPhase] = useState<GamePhase>("idle");
  const [roundIndex, setRoundIndex] = useState(0);
  const [views, setViews] = useState<RoundView[]>([]);
  const [summary, setSummary] = useState<CourseSummary | null>(null);
  const [comparisonView, setComparisonView] = useState<Comparison | null>(null);
  const [orientationNote, setOrientationNote] = useState<string | null>(null);
  const [roundNote, setRoundNote] = useState<string | null>(null);

  const [cardUrl, setCardUrl] = useState<string | null>(null);
  const [cardBlob, setCardBlob] = useState<Blob | null>(null);
  const [cardName, setCardName] = useState<string>("poomsae-card.png");
  const [cardNote, setCardNote] = useState<string | null>(null);
  const [cardBusy, setCardBusy] = useState(false);

  const course: Course = useMemo(() => courseById(courseId), [courseId]);
  const pose: ReferencePose = useMemo(() => referencePose(course.poseId), [course.poseId]);

  // 코스를 바꾸면 선언 각도도 그 코스가 전제하는 값으로 돌아간다.
  useEffect(() => setDeclaredView(course.view), [course.view]);

  /**
   * 판정에 넘길 카메라 각도.
   *
   * 시연 모드는 코스의 값이다 — 흘려보내는 샘플이 그 각도로 만들어져 있으므로 사용자가
   * 선언할 것이 없다. 웹캠 모드에서만 사람이 선언한 값을 그대로 넘기고, 전제와 다르면
   * 판정 코어가 H6으로 보류한다(게임이 대신 판단하지 않는다).
   */
  const judgeView: CameraView = mode === "webcam" ? declaredView : course.view;

  /**
   * 이 코스가 시연에 쓸 샘플이 전부 손에 들어왔는가.
   *
   * 샘플을 못 읽은 채로 시작하면 흘려보낼 프레임이 없어 **다섯 라운드가 전부 보류**로
   * 끝난다. 코어는 그 경우에도 점수를 지어내지 않고 "판정할 창을 하나도 세우지 못했다"고
   * 말하지만, 처음 열어 본 사람에게는 게임이 고장난 것으로 보인다. 그래서 시작 자체를
   * 막는다 — 보류는 판정의 결론이어야지, 파일을 덜 읽었다는 뜻이면 안 된다.
   */
  const demoReady = useMemo(
    () => course.rounds.every((r) => samples.some((s) => s.id === r.demoSampleId)),
    [course.rounds, samples],
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const loopRef = useRef<LoopState>(emptyLoop());
  const effectsRef = useRef<EffectLayer>(new EffectLayer());
  /** HUD 도 이 선호를 지켜야 한다. 캔버스에 그리는 쪽은 matchMedia 를 모른다. */
  const reducedMotionRef = useRef(false);
  const liveFrameRef = useRef<PoseFrame | null>(null);
  const rafRef = useRef<number | null>(null);
  const revokeRef = useRef<(() => void) | null>(null);

  const webcam = useWebcamPose(course.motion, judgeView);
  const webcamRunning = webcam.status === "running";
  const mirror = mode === "webcam";

  const aspect =
    mode === "webcam" ? (webcam.sequence?.aspect ?? 4 / 3) : (samples[0]?.aspect ?? 4 / 3);

  /* ── 샘플 ──────────────────────────────────────────────────────── */

  useEffect(() => {
    let alive = true;
    loadSamples()
      .then((res) => {
        if (!alive) return;
        setSamples(res.sequences);
        if (res.sequences.length === 0) {
          setLoadNote(
            "시연 모드가 흘려보낼 샘플을 하나도 읽지 못했습니다. 저장소 루트에서 'npm run samples' 로 다시 구울 수 있습니다. (교본은 코드로 생성되므로 그대로 보입니다.)",
          );
        }
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setLoadNote(`샘플을 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 접근성: 움직임을 줄이라고 한 사람에게는 플래시·파티클을 그리지 않는다.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      reducedMotionRef.current = mq.matches;
      effectsRef.current.setReducedMotion(mq.matches);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // 시연 모드로 돌아오면 카메라를 끈다. "켤 때만 켜집니다"가 거짓말이 되지 않게.
  const stopWebcam = webcam.stop;
  useEffect(() => {
    if (mode !== "webcam") stopWebcam();
  }, [mode, stopWebcam]);

  useEffect(
    () => () => {
      revokeRef.current?.();
    },
    [],
  );

  /* ── 웹캠 프레임을 기록기로 옮기는 어댑터 ──────────────────────── */

  /**
   * 훅이 180ms마다 다시 만드는 최근 4초 시퀀스에서 **아직 보지 못한 프레임만** 꺼내 온다.
   * 좌표 배열의 신원(`f.world`)이 배치를 다시 만들어도 유지되기 때문에 중복 없이 이어 붙는다.
   *
   * **시각은 배치가 싣고 온 `epochMs` 로 옮긴다.** 예전에는 이 효과가 도는 시각(`now`)에서
   * 배치 안의 상대 간격을 빼서 되짚었는데, 그 시각은 마지막 프레임이 찍힌 시각보다 배치
   * 지연 L 만큼 늦다. 대수로 쓰면 `rel = 참값 + L` 이고 L > 0 이 항상 참이므로,
   * **참값이 [−L, 0) 인 준비 단계 프레임이 rel ≥ 0 으로 살아남아 채점 대상이 됐다.**
   * `judgeRound` 의 음수 가드는 이 어댑터가 이미 버린 뒤에 도는 검사라 그 경로를 잡지 못한다.
   * epoch 을 쓰면 편향이 0이고, 게임이 피하려던 함정(준비 자세 채점)이 두 모드 모두에서 닫힌다.
   *
   * epoch 이 없는 시퀀스는 이 경로에 오지 않는다(웹캠 훅만 이 효과를 먹인다).
   * 그래도 오면 **기록하지 않는다** — 시각을 못 믿는 프레임을 채점하느니 보류가 낫다.
   */
  useEffect(() => {
    const seq = webcam.sequence;
    if (!seq || seq.frames.length === 0) return;
    liveFrameRef.current = seq.frames[seq.frames.length - 1];

    const st = loopRef.current;
    if (st.phase !== "capture") return;
    const epoch = seq.epochMs;
    if (epoch === undefined) return;
    const limitMs = (st.rounds[st.roundIndex]?.limitSeconds ?? 0) * 1000;
    let added = false;
    for (const f of seq.frames) {
      if (st.seen.has(f.world)) continue;
      st.seen.add(f.world);
      const rel = epoch + f.t - st.captureStart;
      if (rel < 0 || rel > limitMs) continue;
      st.record.push({ t: rel, image: f.image, world: f.world });
      added = true;
    }
    if (added) st.record.sort((a, b) => a.t - b.t);
  }, [webcam.sequence]);

  /* ── 라운드 전이 ───────────────────────────────────────────────── */

  const enter = useCallback((p: GamePhase, ts: number) => {
    const st = loopRef.current;
    st.phase = p;
    st.phaseStart = ts;
    setPhase(p);
  }, []);

  const finishRound = useCallback(
    (ts: number) => {
      const st = loopRef.current;
      const round = st.rounds[st.roundIndex];
      const motion = pose.judgedMotion;
      if (!round || motion === null) return;

      // 판정에 넘길 기록. **시간이 단조 증가해야 한다** — 같은 ms 로 겹친 프레임은 버린다.
      const timed: TimedFrame[] = [];
      const frames: PoseFrame[] = [];
      let prevT = -1;
      for (const f of st.record) {
        const t = Math.round(f.t * 10) / 10;
        if (t <= prevT) continue;
        prevT = t;
        timed.push({ t, landmarks: f.world });
        frames.push({ t, image: f.image, world: f.world });
      }
      const span = timed.length > 1 ? timed[timed.length - 1].t - timed[0].t : 0;
      const fps = span > 0 ? Math.max(1, Math.round(((timed.length - 1) / span) * 1000)) : 30;

      let result: RoundResult;
      try {
        result = judgeRound({
          motion,
          view: judgeView,
          limitSeconds: round.limitSeconds,
          frames: timed,
          fps,
          comboBefore: st.combo,
          sequenceId: `follow-${course.id}-r${round.index + 1}`,
          label: `${pose.labelKo} ${round.index + 1}라운드`,
        });
      } catch (err) {
        setRoundNote(
          `이 라운드를 채점하지 못했습니다: ${err instanceof Error ? err.message : String(err)}`,
        );
        st.combo = 0;
        // 이전 라운드의 화면을 남겨 두지 않는다. 그냥 두면 판정 단계가 지난 라운드의
        // 점수와 프레임을 되감으면서 '판정'이라고 적는다 — 실패한 라운드가 성공으로 보인다.
        st.lastView = null;
        enter("verdict", ts);
        return;
      }

      st.combo = result.comboAfter;
      const view = buildView(result, frames);
      st.views = [...st.views, view];
      st.lastView = view;
      setViews(st.views);
      setRoundNote(result.status === "withheld" ? result.note : null);

      // 손맛: 맞으면 플래시 + 파티클, 보류면 조용히.
      const fx = effectsRef.current;
      const base = result.baseScore;
      if (result.success && base !== null) {
        const excellent = base >= EXCELLENT_BASE_SCORE;
        fx.flash(excellent ? 0.4 : 0.25);
        fx.burst(W / 2, H / 2, excellent ? 220 : 120, excellent ? "#56d98a" : "#7aa2f7");
      } else if (base !== null) {
        fx.burst(W / 2, H / 2, 60, "#f2c15b");
      }
      enter("verdict", ts);
    },
    [course.id, judgeView, enter, pose.judgedMotion, pose.labelKo],
  );

  const nextRound = useCallback(
    (ts: number) => {
      const st = loopRef.current;
      if (st.roundIndex + 1 >= st.rounds.length) {
        setSummary(summarizeCourse(st.views.map((v) => v.result)));
        enter("done", ts);
        return;
      }
      st.roundIndex += 1;
      setRoundIndex(st.roundIndex);
      setRoundNote(null);
      loadDemoFrames(st, samples);
      enter("present", ts);
    },
    [enter, samples],
  );

  /* ── 그리기 ────────────────────────────────────────────────────── */

  const drawFrame = useCallback(
    (ts: number, dtMs: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const cssWidth = canvas.clientWidth || W;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const tw = Math.round(W * dpr);
      const th = Math.round(H * dpr);
      if (canvas.width !== tw || canvas.height !== th) {
        canvas.width = tw;
        canvas.height = th;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const st = loopRef.current;
      const round = st.rounds[st.roundIndex] ?? null;
      const elapsed = ts - st.phaseStart;

      // 무엇을 보여 줄 것인가
      let displayed: PoseFrame | null = null;
      if (st.phase === "verdict" && st.lastView && st.lastView.replay.length > 0) {
        // 판정이 실제로 읽은 구간을 되감는다(게임의 2초 창이 아니다).
        const r = st.lastView.replay;
        const u = Math.min(0.999, Math.max(0, elapsed / FEEDBACK_MS));
        displayed = r[Math.floor(u * r.length)] ?? r[r.length - 1];
      } else if (st.phase === "capture") {
        displayed = st.record[st.record.length - 1] ?? null;
      } else if (mode === "webcam") {
        displayed = liveFrameRef.current;
      }

      // 어긋남은 비교 코어가 정한다. 여기서 각도를 다시 재지 않는다.
      const choice = displayed ? chooseOrientation(pose, displayed.world) : null;
      const refWorld: readonly Landmark[] = choice?.mirrored ? mirrorFrame(pose.frame) : pose.frame;
      const ghost = displayed
        ? fitReferenceToFrame(displayed, refWorld, aspect)
        : fitReferenceStandalone(pose.frame, aspect);

      drawPose(ctx, W, H, {
        landmarks: displayed?.image ?? null,
        video: mode === "webcam" && webcamRunning ? webcam.videoRef.current : null,
        theme: DARK_THEME,
        mirror,
      });
      drawOverlay(ctx, W, H, {
        mirror,
        ghost,
        player: displayed?.image ?? null,
        comparison: choice?.comparison ?? null,
        alpha: st.phase === "present" ? 1 : 0.95,
        // 좁은 화면에서는 숫자 라벨을 접는다(위 NARROW_CANVAS_PX 주석). 링과 색은 남는다.
        maxLabels: cssWidth < NARROW_CANVAS_PX ? 0 : 4,
      });

      effectsRef.current.draw(ctx, W, H, dtMs);

      const base = st.lastView?.result.baseScore ?? null;
      const hud: HudState = {
        phase: st.phase,
        roundNumber: st.roundIndex + 1,
        roundCount: st.rounds.length || course.rounds.length,
        countdown: st.phase === "ready" ? Math.max(0, (READY_MS - elapsed) / 1000) : null,
        remainMs:
          st.phase === "capture"
            ? Math.max(0, (round?.limitSeconds ?? 0) * 1000 - elapsed)
            : null,
        limitMs: (round?.limitSeconds ?? 1) * 1000,
        comboMultiplier: comboMultiplier(st.combo),
        verdictBase: base,
        verdictWithheld: st.lastView !== null && st.lastView.result.status === "withheld",
        verdictProgress: elapsed / FEEDBACK_MS,
        poseName: pose.labelKo,
        cue: pose.judgedMotion ? CUE[pose.judgedMotion] : "",
        successThreshold: SUCCESS_BASE_SCORE,
        excellentThreshold: EXCELLENT_BASE_SCORE,
        // 되감기는 게임의 2초 창이 아니라 **판정이 실제로 읽은 구간**이다. 그 길이를 넘겨
        // HUD 가 창 길이를 문자열에 박지 않게 한다(주춤서기 1.4초, 앞차기 0.7초 등).
        replaySeconds: replaySecondsOf(st.lastView),
        reducedMotion: reducedMotionRef.current,
      };
      drawHud(ctx, W, H, hud);

      // 곁 패널의 숫자는 천천히 올린다.
      if (ts - st.lastPanelPush > PANEL_REFRESH_MS) {
        st.lastPanelPush = ts;
        setComparisonView(choice?.comparison ?? null);
        setOrientationNote(choice && choice.mirrored ? choice.reasonKo : null);
      }
    },
    [aspect, course.rounds.length, mirror, mode, pose, webcam.videoRef, webcamRunning],
  );

  /* ── rAF 루프 ──────────────────────────────────────────────────── */

  useEffect(() => {
    if (phase === "idle") return;
    let stopped = false;
    const tick = (ts: number) => {
      if (stopped) return;
      const st = loopRef.current;
      const dt = st.lastTs === 0 ? 16 : ts - st.lastTs;
      st.lastTs = ts;
      // 탭을 벗어난 동안에는 단계가 흐르지 않는다. 돌아오는 순간 `visibilitychange` 가
      // 제시 단계부터 다시 세운다 — 그 전에 한 틱이라도 돌면 빈 기록으로 라운드가 끝난다.
      if (st.suspended) {
        drawFrame(ts, dt);
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const elapsed = ts - st.phaseStart;
      const round = st.rounds[st.roundIndex];

      switch (st.phase) {
        case "present":
          if (elapsed >= PRESENT_MS) enter("ready", ts);
          break;
        case "ready":
          if (elapsed >= READY_MS) {
            // 기록기를 여는 것은 여기 한 곳뿐이다. 이 순간이 t = 0 이다.
            st.record = [];
            // 시작 신호의 벽시계. rAF 의 `ts` 는 이 콜백이 실행되기 **전**(프레임 시작)의
            // 시각이라 과거를 가리킨다. 그만큼 기록 창이 앞으로 벌어져 준비 단계 쪽을
            // 먹으므로, 웹캠 프레임과 같은 축의 '지금'을 여기서도 쓴다.
            st.captureStart = performance.now();
            st.seen = new WeakSet<object>();
            st.demoNextT = 0;
            st.demoK = 0;
            enter("capture", ts);
            effectsRef.current.flash(0.18);
          }
          break;
        case "capture":
          if (round) {
            feedDemo(st, elapsed, round.limitSeconds * 1000, mode);
            if (elapsed >= round.limitSeconds * 1000) finishRound(ts);
          }
          break;
        case "verdict":
          if (elapsed >= FEEDBACK_MS) nextRound(ts);
          break;
        default:
          break;
      }

      drawFrame(ts, dt);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [phase, drawFrame, enter, finishRound, mode, nextRound]);

  /**
   * 탭을 벗어나면 그 라운드를 **명시적으로 무효**로 하고, 돌아왔을 때 제시부터 다시 한다.
   *
   * 그냥 두면 rAF가 멈춰 프레임 공백이 생기고, 어차피 H3(120ms)으로 보류가 된다.
   * "왜 갑자기 0점이지"를 겪게 하는 것보다 무효라고 말하고 다시 시작하는 편이 정직하다.
   *
   * 두 가지를 같이 지킨다.
   *
   * **(ㄱ) 다시 세우는 시각은 '돌아온 지금'이다.** 숨는 순간의 시각을 단계 시작으로 박으면
   * rAF 가 멈춘 동안 시간만 흘러, 돌아온 첫 틱에서 제시(1.5초)가 통째로 건너뛰어진다 —
   * 무슨 자세를 해야 하는지 보여 주는 유일한 단계다.
   *
   * **(ㄴ) 콤보는 끊는다.** 끊지 않으면 망한 라운드를 탭 전환 한 번으로 무한정 다시 할 수
   * 있고 배수는 그대로 남는다. 점수와 별이 걸린 화면에서 그것은 재시도가 아니라 치트 경로다.
   */
  useEffect(() => {
    if (phase === "idle" || phase === "done") return;
    const onVisibility = () => {
      const st = loopRef.current;
      if (st.phase === "verdict" || st.phase === "done") return;
      if (document.visibilityState === "hidden") {
        st.suspended = true;
        st.record = [];
        st.demoNextT = 0;
        st.demoK = 0;
        st.combo = 0;
        setRoundNote("화면을 벗어나 이 라운드를 다시 합니다. 기록은 버리고 콤보도 끊깁니다.");
        return;
      }
      st.suspended = false;
      enter("present", performance.now());
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [phase, enter]);

  /* ── 시작·정지 ─────────────────────────────────────────────────── */

  const start = useCallback(() => {
    // 인코더를 미리 깨워 둔다. 콜드 스타트 1078ms 를 라운드 중에 만나지 않게.
    warmUpPngEncoder();
    revokeRef.current?.();
    revokeRef.current = null;
    setCardUrl(null);
    setCardBlob(null);
    setCardNote(null);
    setSummary(null);
    setViews([]);
    setRoundIndex(0);
    setRoundNote(null);

    const st = emptyLoop();
    st.rounds = course.rounds;
    st.phaseStart = performance.now();
    loopRef.current = st;
    loadDemoFrames(st, samples);
    effectsRef.current.clear();
    enter("present", st.phaseStart);
  }, [course.rounds, enter, samples]);

  const quit = useCallback(() => {
    loopRef.current = emptyLoop();
    setPhase("idle");
    setViews([]);
    setSummary(null);
    setRoundNote(null);
    setComparisonView(null);
  }, []);

  /* ── 결과 카드 ─────────────────────────────────────────────────── */

  const buildCardInput = useCallback((): CardInput | null => {
    const s = summary;
    const list = loopRef.current.views;
    if (!s || list.length === 0) return null;
    // 채점된 라운드가 하나도 없으면 카드를 만들지 않는다. 예전에는 `?? 0` 으로 떨어져
    // **잘 맞은 라운드가 하나도 없는데 1라운드를 지목**하는 카드가 나왔다.
    const bestIndex = s.bestRoundIndex;
    if (bestIndex === null) return null;
    const best = list[bestIndex];
    const judgement = best?.result.judgement ?? null;
    if (!best || !judgement) return null;

    const hero = best.hero;
    const choice = hero ? chooseOrientation(pose, hero.world) : null;
    const refWorld: readonly Landmark[] = choice?.mirrored ? mirrorFrame(pose.frame) : pose.frame;
    const ghost = hero ? fitReferenceToFrame(hero, refWorld, aspect) : null;
    const toPoints = (lms: readonly Landmark[] | null): CardPoint[] | null =>
      lms ? lms.map((p) => ({ x: p.x, y: p.y })) : null;

    return cardInputFromJudgement(
      judgement,
      {
        totalScore: s.totalScore,
        averageBase: s.averageBase,
        stars: s.stars,
        rounds: list.map((v) => ({ baseScore: v.result.baseScore, total: v.result.score })),
      },
      {
        courseLabel: course.labelKo,
        // 카드 안에서 시계를 읽지 않는다 — 날짜는 호출자가 넘긴다(지역 달력 기준).
        dateISO: localDateISO(new Date()),
        originLabel: mode === "webcam" ? "웹캠 실시간" : "합성 샘플 파일",
        bestRoundNumber: bestIndex + 1,
        skeleton: {
          mine: toPoints(hero?.image ?? null) ?? [],
          reference: toPoints(ghost),
          aspect,
        },
      },
    );
  }, [aspect, course.labelKo, mode, pose, summary]);

  // 결과 화면에 들어오면 카드를 한 장 그려 둔다. 기록은 이미 끝났으므로 H3과 무관하다.
  useEffect(() => {
    if (phase !== "done" || !summary) return;
    const input = buildCardInput();
    if (!input) {
      setCardNote("모든 라운드가 보류라 카드에 실을 판정이 없습니다. 점수를 지어내지 않습니다.");
      return;
    }
    let alive = true;
    setCardBusy(true);
    try {
      const canvas = createCardCanvas();
      renderCard(canvas, input);
      setCardName(cardFileName(sanitizeCardData(input)));
      void canvasToPngBlob(canvas)
        .then((blob) => {
          if (!alive) return;
          revokeRef.current?.();
          const { url, revoke } = previewUrl(blob);
          revokeRef.current = revoke;
          setCardBlob(blob);
          setCardUrl(url);
          setCardBusy(false);
        })
        .catch((err: unknown) => {
          if (!alive) return;
          setCardNote(
            `카드를 PNG로 굽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`,
          );
          setCardBusy(false);
        });
    } catch (err) {
      setCardNote(`카드를 그리지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
      setCardBusy(false);
    }
    return () => {
      alive = false;
    };
  }, [phase, summary, buildCardInput]);

  const saveCard = useCallback(async () => {
    if (!cardBlob) return;
    const how = await shareOrDownloadCard(cardName, cardBlob);
    const note =
      how === "shared"
        ? "공유 시트로 넘겼습니다."
        : how === "cancelled"
          ? "공유를 취소했습니다. 파일은 저장되지 않았습니다 — 아래 [PNG 내려받기]로 받을 수 있습니다."
          : `${cardName} 을(를) 내려받았습니다. 영상 픽셀과 얼굴 좌표는 한 점도 들어 있지 않습니다.`;
    setCardNote(note);
  }, [cardBlob, cardName]);

  const downloadOnly = useCallback(() => {
    if (!cardBlob) return;
    downloadBlob(cardName, cardBlob);
    setCardNote(`${cardName} 을(를) 내려받았습니다.`);
  }, [cardBlob, cardName]);

  /* ── 화면 ──────────────────────────────────────────────────────── */

  const playing = phase !== "idle" && phase !== "done";
  const phaseLabel: Record<GamePhase, string> = {
    idle: "대기",
    present: "교본 제시",
    ready: "준비 — 아직 기록하지 않습니다",
    capture: "맞추기 — 기록 중",
    verdict: "판정",
    done: "결과",
  };

  /**
   * 화면을 못 보는 사람에게 읽히는 줄.
   *
   * 게임의 내용은 전부 `aria-hidden` 캔버스 안에 있다. 단계 이름만 읽어 주면
   * "교본 제시 · 1라운드"까지만 전해지고 **무슨 자세를 하라는 것인지도, 몇 점인지도**
   * 전해지지 않는다. 컴포넌트가 이미 들고 있는 문자열을 여기서 같이 읽어 준다.
   */
  const lastResult = views.at(-1)?.result ?? null;
  const liveText = (() => {
    const head = `${phaseLabel[phase]} · ${roundIndex + 1}라운드`;
    if (phase === "present" || phase === "ready") {
      return `${head}. ${pose.labelKo}. ${pose.judgedMotion ? CUE[pose.judgedMotion] : ""}`;
    }
    if (phase === "verdict" && lastResult) {
      return lastResult.status === "scored"
        ? `${head}. 기본점 ${lastResult.baseScore}점, 라운드 ${lastResult.score}점.`
        : `${head}. 보류 — ${lastResult.note}`;
    }
    return head;
  })();

  return (
    <div className={styles.shell}>
      <div className={styles.topBar}>
        <h1 className={styles.title}>따라하기 게임</h1>
        <Link href="/" className={styles.backLink}>
          ← 판정 화면으로
        </Link>
      </div>
      <p className={styles.lede}>
        화면이 교본 자세를 제시하고, 제한 시간 안에 그 자세를 만들면 이미 있는 판정 코어가 점수를
        냅니다. 새 채점 규칙은 하나도 없습니다 — 점수는 기존 감점을 0~100으로 다시 표현한
        것이고, 채점할 수 있는 창이 하나도 없으면 점수를 지어내지 않고 보류라고 말합니다.
      </p>

      {loadNote && (
        <Notice tone="warn" tag="샘플">
          {loadNote}
        </Notice>
      )}

      {!playing && phase !== "done" && (
        <>
          <div className={styles.courses} role="group" aria-label="코스">
            {COURSES.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`${styles.course} ${c.id === courseId ? styles.courseActive : ""}`}
                aria-pressed={c.id === courseId}
                onClick={() => setCourseId(c.id)}
              >
                <span className={styles.courseName}>{c.labelKo}</span>
                <span className={styles.courseNote}>
                  {MOTION_LABEL[c.motion]} · {VIEW_LABEL[c.view]}에서 촬영 전제 · {c.rounds.length}
                  라운드
                </span>
                <span className={styles.courseNote}>
                  제한 시간 {c.rounds.map((r) => r.limitSeconds).join(" → ")}초. 한 판에서 동작을
                  섞지 않는 이유는 규칙이 카메라 각도를 전제하기 때문입니다(H6).
                </span>
              </button>
            ))}
          </div>

          <div className={styles.row}>
            <div className={styles.segmented} role="group" aria-label="입력 모드">
              <button
                type="button"
                className={`${styles.segment} ${mode === "demo" ? styles.segmentActive : ""}`}
                aria-pressed={mode === "demo"}
                onClick={() => setMode("demo")}
              >
                시연 모드 (기본)
              </button>
              <button
                type="button"
                className={`${styles.segment} ${mode === "webcam" ? styles.segmentActive : ""}`}
                aria-pressed={mode === "webcam"}
                onClick={() => setMode("webcam")}
              >
                웹캠으로 하기
              </button>
            </div>
            <span className={styles.hint}>
              {mode === "demo"
                ? "이미 커밋된 합성 샘플을 플레이어 입력 자리에 흘려보냅니다. 카메라 권한을 묻지 않고, 루프·판정·오버레이·카드는 웹캠 모드와 같은 코드를 지납니다. 몇 번을 눌러도 같은 결과입니다."
                : "카메라는 아래 버튼을 누를 때만 켜집니다. 추론은 브라우저 안에서 끝나고 영상은 기기 밖으로 나가지 않습니다."}
            </span>
          </div>

          {mode === "webcam" && (
            <>
              <div className={styles.row}>
                <button
                  type="button"
                  className={styles.ghostButton}
                  disabled={webcam.busy}
                  onClick={webcamRunning ? webcam.stop : webcam.start}
                >
                  {webcam.busy ? "여는 중…" : webcamRunning ? "카메라 끄기" : "카메라 켜기"}
                </button>
                <span className={styles.hint}>
                  {webcam.message ||
                    `${VIEW_LABEL[course.view]}에서 전신이 들어오게 서 주세요. 이 코스의 규칙은 그 각도를 전제합니다.`}
                </span>
              </div>

              <div className={styles.row}>
                <div className={styles.segmented} role="group" aria-label="카메라 각도 선언">
                  {VIEW_CHOICES.map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={`${styles.segment} ${v === declaredView ? styles.segmentActive : ""}`}
                      aria-pressed={v === declaredView}
                      onClick={() => setDeclaredView(v)}
                    >
                      {VIEW_LABEL[v]}에서 찍는 중
                    </button>
                  ))}
                </div>
                <span className={styles.hint}>
                  각도는 화면이 관측할 수 없어 <strong>사람이 선언</strong>합니다. 이 코스가
                  전제하는 각도는 {VIEW_LABEL[course.view]}이고, 다르게 선언하면 판정 코어가
                  점수를 지어내지 않고 <strong>H6으로 보류</strong>합니다.
                  {declaredView === course.view
                    ? ""
                    : " 지금 선언은 전제와 다릅니다 — 이대로 시작하면 다섯 라운드가 전부 보류입니다."}
                </span>
              </div>
            </>
          )}

          {webcam.status === "denied" && (
            <Notice tone="warn" tag="권한 거부">
              {webcam.message} 위에서 &lsquo;시연 모드&rsquo;로 돌아가면 같은 루프를 카메라 없이 전부
              볼 수 있습니다.
            </Notice>
          )}
          {webcam.status === "error" && (
            <Notice tone="bad" tag="카메라 오류">
              {webcam.message}
            </Notice>
          )}

          <button
            type="button"
            className={styles.primary}
            disabled={(mode === "webcam" && !webcamRunning) || (mode === "demo" && !demoReady)}
            onClick={start}
          >
            {mode === "webcam" && !webcamRunning
              ? "카메라를 먼저 켜 주세요"
              : mode === "demo" && !demoReady
                ? "샘플을 읽는 중…"
                : "시작하기"}
          </button>

          <p className={styles.meta}>교본 근거: {pose.sourceNote}</p>
        </>
      )}

      {(playing || phase === "done") && (
        <div className={phase === "done" ? styles.result : styles.play}>
          {phase === "done" ? (
            <div>
              <section className={styles.card} aria-label="총점">
                <h2 className={styles.cardTitle}>{course.labelKo}</h2>
                <div className={styles.scoreBoard}>
                  <span className={styles.bigScore}>{summary?.totalScore ?? 0}</span>
                  <span className={styles.scoreUnit}>점</span>
                  <span className={styles.stars} aria-label={`별 ${summary?.stars ?? 0}개`}>
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className={i < (summary?.stars ?? 0) ? styles.starOn : styles.starOff}
                        aria-hidden="true"
                      >
                        ★
                      </span>
                    ))}
                  </span>
                </div>
                <p className={styles.meta}>
                  별은 총점이 아니라 <strong>기본점 평균</strong>(
                  {summary?.averageBase.toFixed(1)})으로만 매깁니다. 콤보와 속도는 점수판에만
                  보탭니다 — 잘 맞춘 사람과 빨리 맞춘 사람을 같은 별로 부르지 않으려는 것입니다.
                  {summary && summary.withheldRounds > 0
                    ? ` 보류 ${summary.withheldRounds}라운드는 0점이 아니라 '채점하지 않음'입니다.`
                    : ""}
                </p>
                <RoundList views={views} />
              </section>
              <div className={styles.buttonRow}>
                <button type="button" className={styles.primary} onClick={start}>
                  다시 하기
                </button>
                <button type="button" className={styles.ghostButton} onClick={quit}>
                  코스 고르기
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className={styles.stage}>
                <canvas ref={canvasRef} className={styles.stageCanvas} aria-hidden="true" />
              </div>
              <p className={styles.srOnly} role="status" aria-live="polite">
                {liveText}
              </p>
              {roundNote && (
                <Notice tone="warn" tag="라운드">
                  {roundNote}
                </Notice>
              )}
              <div className={styles.buttonRow}>
                <button type="button" className={styles.ghostButton} onClick={quit}>
                  그만두기
                </button>
              </div>
            </div>
          )}

          <div style={{ display: "grid", gap: 16 }}>
            {phase === "done" ? (
              <section className={styles.card} aria-label="결과 카드">
                <h2 className={styles.cardTitle}>결과 카드</h2>
                {cardBusy && <p className={styles.hint}>카드를 그리는 중…</p>}
                {cardUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={cardUrl}
                    alt="판정 결과 카드"
                    width={1080}
                    height={1350}
                    className={styles.cardPreview}
                  />
                )}
                <div className={styles.buttonRow}>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    disabled={!cardBlob}
                    onClick={() => void saveCard()}
                  >
                    저장 · 공유
                  </button>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    disabled={!cardBlob}
                    onClick={downloadOnly}
                  >
                    PNG 내려받기
                  </button>
                </div>
                <p className={styles.meta}>
                  1080×1350 · 고정 배율 2. 기기가 달라도 <strong>같은 판정 · 같은 날짜</strong>면
                  같은 이미지가 나옵니다(카드에 들어가는 외부 값은 보는 사람의 달력 날짜 하나뿐입니다).
                  영상 픽셀은 한 점도 들어가지 않고(좌표에서 새로 그립니다), 얼굴 랜드마크 0~10번은
                  정제 단계에서 버려집니다. 모바일에서 내려받기가 막히면 이미지를 길게 눌러
                  저장하세요.
                </p>
                {cardNote && <p className={styles.hint}>{cardNote}</p>}
              </section>
            ) : (
              <>
                <section className={styles.card} aria-label="점수판">
                  <h2 className={styles.cardTitle}>점수판</h2>
                  <div className={styles.scoreBoard}>
                    <span className={styles.bigScore}>
                      {views.reduce((a, v) => a + v.result.score, 0)}
                    </span>
                    <span className={styles.scoreUnit}>
                      점 · 콤보 ×{comboMultiplier(views.at(-1)?.result.comboAfter ?? 0).toFixed(1)}
                    </span>
                  </div>
                  <RoundList views={views} />
                </section>

                <section className={styles.card} aria-label="교본과의 차이">
                  <h2 className={styles.cardTitle}>
                    교본과의 차이 — {phase === "verdict" ? "되감는 프레임" : "지금 프레임"}
                  </h2>
                  <MetricTable comparison={comparisonView} />
                  {orientationNote && <p className={styles.meta}>{orientationNote}</p>}
                  <OverlayLegend motion={pose.judgedMotion} />
                </section>
              </>
            )}
          </div>
        </div>
      )}

      <footer className={styles.footer}>
        <p>
          판정 규칙(감점값·경계값·보류 조건)은 이 화면에서 한 글자도 바뀌지 않습니다. 게임 점수는
          기존 감점의 재표현이고, 10점 만점 원점수와 감점 근거(측정값·경계값)는 결과 카드에 함께
          실립니다.
        </p>
        <p>
          이 판정 규칙은 유단자·심판의 검토를 받지 않았습니다. 실제 대회 채점을 대체할 수 없습니다.
        </p>
      </footer>
    </div>
  );
}

/* ── 작은 조각들 ───────────────────────────────────────────────────── */

/**
 * 되감기 구간과 카드에 박을 프레임을 고른다.
 *
 * 되감기는 게임이 고른 2초 창이 아니라 **판정이 그 안에서 다시 고른 구간**을 보여 준다 —
 * `findStanceWindow` 가 창 안에서 또 한 번 "멈춘 구간"을 고르기 때문이다. 창을 보여 주면
 * 화면의 되감기와 실제 채점 구간이 어긋난다.
 */
function buildView(result: RoundResult, frames: readonly PoseFrame[]): RoundView {
  const w = result.window;
  if (!w || frames.length === 0) {
    return { result, frames, replay: frames, hero: frames[Math.floor(frames.length / 2)] ?? null };
  }
  const from = w.judgedFromMs;
  const to = w.judgedToMs;
  const inRange =
    from !== null && to !== null
      ? frames.filter((f) => f.t >= from && f.t <= to)
      : frames.slice(w.fromIndex, w.toIndex + 1);
  const replay = inRange.length > 0 ? inRange : frames.slice(w.fromIndex, w.toIndex + 1);
  return { result, frames, replay, hero: replay[Math.floor(replay.length / 2)] ?? null };
}

/**
 * 되감기 구간의 길이(초). **게임의 2초 창이 아니다** — 판정이 창 안에서 다시 고른 구간이다.
 * HUD 가 "2초"를 문자열에 박지 않게 이 값을 넘긴다(주춤서기 1.4초, 앞차기 0.7초 등).
 */
function replaySecondsOf(view: RoundView | null): number | null {
  if (!view || view.replay.length < 2) return null;
  const span = view.replay[view.replay.length - 1].t - view.replay[0].t;
  return span > 0 ? span / 1000 : null;
}

function RoundList({ views }: { views: readonly RoundView[] }) {
  if (views.length === 0) {
    return <p className={styles.hint}>아직 끝난 라운드가 없습니다.</p>;
  }
  return (
    <div className={styles.roundList}>
      {views.map((v, i) => {
        const r = v.result;
        const base = r.baseScore ?? 0;
        return (
          <div key={i} className={styles.roundRow}>
            <span className={styles.roundLabel}>{i + 1}라운드</span>
            <span className={styles.roundTrack}>
              <span
                className={styles.roundFill}
                style={{
                  width: `${Math.max(0, Math.min(100, base))}%`,
                  background:
                    base >= EXCELLENT_BASE_SCORE
                      ? "var(--ok)"
                      : base >= SUCCESS_BASE_SCORE
                        ? "var(--brand)"
                        : "var(--warn)",
                }}
              />
            </span>
            <span
              className={styles.roundValue}
              style={{ color: r.status === "scored" ? "var(--fg)" : "var(--hold)" }}
            >
              {r.status === "scored"
                ? `${r.baseScore} ×${r.comboMultiplier.toFixed(1)} +${r.speedPoints} = ${r.score}`
                : "보류"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function MetricTable({ comparison }: { comparison: Comparison | null }) {
  if (!comparison) {
    return (
      <p className={styles.hint}>
        아직 읽은 자세가 없습니다. 맞추기가 시작되면 지표마다 교본과의 차이가 여기에 뜹니다.
      </p>
    );
  }
  const rows: readonly MetricComparison[] = [...comparison.metrics]
    .sort((a, b) => (a.score ?? 999) - (b.score ?? 999))
    .slice(0, 6);
  // 색은 **오버레이 토큰**을 쓴다. 감점의 --bad/--warn 을 쓰면 이 표가 "깎였다"고
  // 말하는 셈인데, 교본과의 차이는 감점을 만들지 않는다(globals.css --off 주석).
  const color = (m: MetricComparison) =>
    m.band === "off"
      ? "var(--off)"
      : m.band === "warn"
        ? "var(--off-soft)"
        : m.band === "unreadable"
          ? "var(--hold)"
          : "var(--ok)";
  return (
    <>
      <p className={styles.hint} style={{ marginBottom: 8 }}>
        일치도 {comparison.match === null ? "재지 못함" : `${comparison.match.toFixed(0)} / 100`} ·
        읽은 지표 {comparison.readableCount}개, 못 읽은 지표 {comparison.unreadableCount}개 ·
        <strong> 점수와 다른 값입니다(표시 전용).</strong>
      </p>
      <div className={styles.deltaList}>
        {rows.map((m) => (
          <div key={m.id} className={styles.deltaRow}>
            <span className={styles.deltaName}>{m.labelKo}</span>
            <span className={styles.deltaPair}>
              {m.measured === null
                ? "읽지 못함"
                : `${fmt(m.measured, m.unit)} / 교본 ${fmt(m.target, m.unit)}`}
            </span>
            <span className={styles.deltaDiff} style={{ color: color(m) }}>
              {m.diff === null ? "—" : metricDeltaText(m)}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function fmt(v: number, unit: "deg" | "ratio"): string {
  return unit === "deg" ? `${v.toFixed(1)}°` : `${v.toFixed(2)}·S`;
}

/* ── 시연 모드 먹이기 ──────────────────────────────────────────────── */

function loadDemoFrames(st: LoopState, samples: readonly PoseSequence[]): void {
  const round = st.rounds[st.roundIndex];
  if (!round) return;
  const seq = samples.find((s) => s.id === round.demoSampleId) ?? null;
  st.demoFrames = seq?.frames ?? null;
  st.demoDt = seq && seq.fps > 0 ? 1000 / seq.fps : 1000 / 30;
  st.demoNextT = 0;
  st.demoK = 0;
}

/**
 * 시연 모드에서 합성 샘플을 기록기로 흘려보낸다.
 *
 * 프레임에 붙이는 시각은 **실제 시각이 아니라 예정된 시각**이다. 브라우저가 한 번 밀려도
 * 프레임 간격이 33ms 로 유지되므로 H3(120ms)에 걸리지 않고, 무엇보다 **몇 번을 눌러도 같은
 * 결과**가 나온다. 샘플은 선 자세에서 시작해 선 자세로 끝나므로 이어 붙여도 이음매가 없다.
 */
function feedDemo(st: LoopState, elapsedMs: number, limitMs: number, mode: Mode): void {
  if (mode !== "demo") return;
  const frames = st.demoFrames;
  if (!frames || frames.length === 0) return;
  // 시각 계산은 `@/follow` 의 순수 함수가 한다 — 간격이 곧 H3(120ms)이고 결정성이라,
  // 화면 안에 두면 테스트가 닿지 않는다.
  const times = demoTickTimes(st.demoNextT, elapsedMs, limitMs, st.demoDt);
  for (const t of times) {
    const f = frames[st.demoK % frames.length];
    st.record.push({ t, image: f.image, world: f.world });
    st.demoK += 1;
  }
  if (times.length > 0) st.demoNextT = times[times.length - 1] + st.demoDt;
}
