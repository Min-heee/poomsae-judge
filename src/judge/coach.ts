/**
 * 판정 결과를 사람이 읽는 문장으로 바꾼다.
 *
 * 왜 이 파일이 판정 코어 안에 있는가: 코칭 문장은 **판정이 이미 관측한 것만**
 * 말해야 한다. 새 사실을 만들지 않는다. 그래서 입력은 `Judgement` 하나뿐이고,
 * 랜드마크도 영상도 보지 않는다. 판정에 없는 말은 구조적으로 나올 수 없다.
 *
 * 결정적이다(PRD 원칙 2). `Date.now()`·`Math.random()`·로캘 의존 포맷을 쓰지
 * 않는다 — 같은 판정이면 같은 문장이 나오고, 그래서 골든 테스트가 가능하다.
 *
 * ── LLM 은 어디까지 들어올 수 있는가 ─────────────────────────────────────
 * 이 앱은 정적 내보내기(`output: 'export'`)라 런타임 서버가 없다. Next 의
 * Route Handler 는 정적 내보내기에서 GET + `force-static` 만 되고, Request 를
 * 읽는 핸들러는 공식 "Unsupported Features" 다 — 판정 결과를 POST 로 받는
 * 라우트는 **빌드가 실패한다**(docs/TECH-NOTES.md 0절·4.3).
 *
 * 그래서 LLM 이 들어올 수 있는 자리는 런타임이 아니라 **빌드 타임**뿐이다.
 * 구체적으로는 빌드 전에 도는 생성 스크립트가 `ruleCoach` 와 같은 입력
 * (`Judgement` 하나)을 받아 문장을 미리 만들고, 그 결과를 정적 파일로 굽는
 * 형태가 된다. 그 결과 PRD 원칙 4(비밀값 커밋 금지)가 말이 아니라 구조로
 * 지켜진다 — 배포물에 키가 들어갈 자리 자체가 없다(`.env.example` 의
 * `LLM_API_KEY` 는 빌드 머신에서만 존재한다).
 *
 * 그 자리를 **인터페이스로 미리 파 두지 않았다.** 구현이 하나뿐인 어댑터와
 * 아무도 부르지 않는 폴백 래퍼는 설계가 아니라 장식이고, 쓰이지 않는 추상화는
 * 읽는 사람에게 "쓸 것처럼 보이려고 만든 자리"로 읽힌다. 필요해지는 날
 * 이 파일의 `ruleCoach` 를 감싸면 된다.
 */

import { MAX_SCORE, MOTION_LABEL_KO, STANCE } from "./constants";
import type { CriterionResult, Judgement, WithholdNote } from "./types";

/** 코칭 한 줄. 화면이 근거로 되짚을 수 있게 출처 항목과 프레임을 달고 다닌다. */
export interface CoachPoint {
  /** 근거가 된 항목 번호. 보류·총평처럼 특정 항목이 없으면 null. */
  criterionId: string | null;
  /** 사람이 읽는 문장. */
  text: string;
  /** 되짚어 볼 프레임. 없으면 null. */
  atFrame: number | null;
  /** 잘한 점인지 고칠 점인지. 화면이 색을 고를 때 쓴다. */
  tone: "good" | "fix" | "hold";
}

export interface CoachAdvice {
  /** 한 줄 총평. */
  headline: string;
  points: readonly CoachPoint[];
  /**
   * 이 문장이 어디서 나왔는가. 화면에 그대로 표시한다 —
   * 읽는 사람이 "이건 모델이 지어낸 말인가"를 물을 수 있어야 한다.
   */
  source: "rules" | "llm";
  /** 출처를 한국어로 한 줄. */
  sourceNote: string;
}

/**
 * 항목별 교정 문장.
 *
 * 문장은 "무엇을 고쳐라"만 말한다. 측정값과 경계값은 화면의 감점 줄이 이미
 * 숫자로 보여 주므로 여기서 다시 적지 않는다 — 두 벌이 되면 어긋난다.
 *
 * 방향이 갈리는 항목(A1 발 간격은 넓어도 좁아도 감점)은 측정값과 합격대를
 * 비교해 갈라 준다. 그 판단도 `CriterionResult` 안의 값만 쓴다.
 */
function fixSentence(c: CriterionResult): string {
  const id = c.id.slice(0, 2).toUpperCase();
  const m = c.measured;
  const bounds = c.boundaries;

  switch (id) {
    case "A1": {
      // 경계 4개(1.50 / 1.70 / 2.30 / 2.60). 합격대는 가운데 둘 사이다.
      const tooNarrow = m !== null && bounds.length >= 2 && m < bounds[1];
      return tooNarrow
        ? "발이 모여 있습니다. 양발을 어깨너비의 두 배까지 벌려 주세요."
        : "발이 지나치게 벌어졌습니다. 어깨너비의 두 배 정도로 좁혀 주세요.";
    }
    case "A2":
      return "무릎이 덜 굽었습니다. 허벅지가 바닥과 나란해지도록 더 앉아 주세요.";
    case "A3":
      return "좌우 무릎이 다르게 굽었습니다. 양쪽을 같은 깊이로 맞춰 주세요.";
    case "A4":
      return "상체가 기울었습니다. 허리를 곧게 세우고 어깨를 엉덩이 위에 두세요.";
    case "A5":
      return "자세가 멈춰 있지 않습니다. 흔들림 없이 더 오래 버텨 주세요.";
    case "B1":
      return "무릎을 먼저 들지 않고 발부터 나갔습니다. 무릎을 접어 올린 뒤에 뻗어 주세요.";
    case "B2":
      return "찬 발을 그대로 내렸습니다. 무릎을 다시 접어 회수한 뒤에 디디세요.";
    case "B3":
      return "차는 높이가 낮습니다. 발끝이 엉덩이 높이를 넘도록 올려 주세요.";
    case "B4":
      return "무릎이 덜 펴졌습니다. 정점에서 무릎을 끝까지 뻗어 주세요.";
    case "B5":
      return "상체가 뒤로 젖혀졌습니다. 허리를 세운 채로 차 주세요.";
    case "B6":
      return "축발이 흔들렸습니다. 디딘 발을 제자리에 고정해 주세요.";
    case "B7":
      return "무릎을 든 뒤 뻗기까지 시간이 걸렸습니다. 들고 나서 곧바로 뻗어 주세요.";
    default:
      // 규칙이 늘었는데 문장을 안 붙인 경우. 지어내지 않고 판정의 근거를 그대로 쓴다.
      return c.note || c.rule;
  }
}

/**
 * 보류 사유를 사람 말로. 코드(H1~H7)는 화면이 따로 보여 주므로 여기선 뜻만 적는다.
 *
 * H1·H2·H3·H5·H6·H7은 사유가 코드 하나에 하나뿐이라 뜻을 풀어 적을 수 있다.
 * **H4는 다르다.** 같은 코드 아래 서로 다른 사유가 들어온다 — 관절이 겹쳐
 * 값을 못 낸 경우, S를 못 구한 경우, 유지 시간이 경계의 ±ε 안인 경우, 흔들림이
 * 경계의 ±5% 안인 경우, 그리고 일반적인 등급 경계 근접. 이것을 한 문장으로
 * 뭉개면 판정이 하지 않은 말을 코칭이 하게 된다(PRD 6절의 약속이 깨지는 자리다).
 * 그래서 H4는 지어내지 않고 판정이 남긴 메시지를 그대로 옮긴다.
 */
function holdSentence(w: WithholdNote): string {
  switch (w.code) {
    case "H1":
      return "일부 프레임에서 관절이 가려져 읽지 못했습니다.";
    case "H2":
      return "읽지 못한 프레임이 너무 많아 채점하지 않았습니다. 전신이 들어오게 다시 찍어 주세요.";
    case "H3":
      return "프레임이 끊긴 구간이 있어 채점하지 않았습니다. 더 안정적인 환경에서 다시 찍어 주세요.";
    case "H5":
      return "채점하지 못한 항목이 많아 전체 판정을 보류했습니다.";
    case "H6":
      return w.message;
    case "H7":
      return (
        `주춤서기로 볼 만큼 멈춘 구간이 없어 채점하지 않았습니다. ` +
        `무릎을 굽혀 발을 벌린 자세로 ${STANCE.minHoldSeconds}초 이상 멈춘 뒤 다시 찍어 주세요.`
      );
    case "H4":
    default:
      return w.message;
  }
}

/** 감점 큰 것부터. 같으면 항목 번호 순 — 순서가 흔들리면 결정성이 깨진다. */
function bySeverity(a: CriterionResult, b: CriterionResult): number {
  if (b.deduction !== a.deduction) return b.deduction - a.deduction;
  return a.id.localeCompare(b.id);
}

/**
 * 규칙 기반 코칭 문장 생성 — 이 프로젝트의 기본 구현.
 *
 * 순수 함수다. 같은 판정이면 항상 같은 문장이 나온다.
 */
export function ruleCoach(judgement: Judgement): CoachAdvice {
  const motion = MOTION_LABEL_KO[judgement.motion];
  const sourceNote = "규칙 기반 생성. 판정이 관측한 항목만 문장으로 옮겼습니다.";

  // ── 전체 보류 ──────────────────────────────────────────────────────────
  // 보류는 실패가 아니다. 점수를 말하지 않고, 왜 못 읽었는지만 말한다.
  if (judgement.status === "withheld" || judgement.score === null) {
    const blocking = judgement.withheld.filter((w) => w.code !== "H1");
    const notes = blocking.length > 0 ? blocking : judgement.withheld;
    return {
      headline: `${motion}: 판정을 보류했습니다. 채점할 만큼 또렷하게 읽지 못했습니다.`,
      points: notes.map((w) => ({
        criterionId: w.code,
        text: holdSentence(w),
        atFrame: w.frames && w.frames.length > 0 ? Math.min(...w.frames) : null,
        tone: "hold" as const,
      })),
      source: "rules",
      sourceNote,
    };
  }

  const deductions = judgement.criteria.filter((c) => c.deduction > 0).sort(bySeverity);
  const withheldItems = judgement.criteria.filter((c) => c.grade === "withheld");
  const points: CoachPoint[] = [];

  // ── 만점 ───────────────────────────────────────────────────────────────
  if (deductions.length === 0) {
    const passed = judgement.criteria.filter((c) => c.grade === "pass");
    points.push({
      criterionId: null,
      text:
        passed.length > 0
          ? `채점한 ${passed.length}개 항목이 모두 합격 범위 안에 들었습니다.`
          : "감점 항목이 없습니다.",
      atFrame: null,
      tone: "good",
    });
  } else {
    // 고칠 것을 먼저, 감점이 큰 것부터. 가장 큰 것 하나를 총평에 올린다.
    for (const c of deductions) {
      points.push({
        criterionId: c.id,
        text: fixSentence(c),
        atFrame: c.atFrame,
        tone: "fix",
      });
    }
    // 잘한 것도 한 줄은 남긴다 — 감점만 나열하면 무엇을 유지해야 할지 알 수 없다.
    const passed = judgement.criteria.filter((c) => c.grade === "pass");
    if (passed.length > 0) {
      points.push({
        criterionId: null,
        text: `나머지 ${passed.length}개 항목(${passed.map((c) => c.id).join(", ")})은 합격 범위 안에 있습니다. 이 부분은 그대로 유지하세요.`,
        atFrame: null,
        tone: "good",
      });
    }
  }

  // 항목 보류(H4)는 감점이 아니다. 섞이지 않게 따로 뒤에 붙인다.
  //
  // 사유는 **판정이 남긴 것을 그대로 옮긴다.** 보류 사유는 한 가지가 아니다 —
  // "관절이 겹쳐 각도를 낼 수 없었다"와 "경계의 ±2° 안이다"는 전혀 다른 사실이고,
  // 둘을 같은 문장으로 바꾸면 코칭이 판정에 없는 말을 하게 된다.
  for (const c of withheldItems) {
    const reason = c.withholdReason ?? c.note;
    points.push({
      criterionId: c.id,
      text: `${c.title}은(는) 채점하지 않았습니다. ${reason} 이 항목은 총점에서 빠졌습니다.`,
      atFrame: c.atFrame,
      tone: "hold",
    });
  }

  const score = judgement.score.toFixed(1);
  const headline =
    deductions.length === 0
      ? `${motion}: ${score}점 / ${MAX_SCORE.toFixed(1)}점. 감점 없이 통과했습니다.`
      : `${motion}: ${score}점 / ${MAX_SCORE.toFixed(1)}점. 가장 크게 깎인 곳은 ${deductions[0].id} ${deductions[0].title}입니다.`;

  return { headline, points, source: "rules", sourceNote };
}
