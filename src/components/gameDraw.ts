/**
 * 게임 화면의 캔버스 HUD와 손맛.
 *
 * **왜 HUD를 캔버스에 그리나:** 남은 시간을 React 상태로 들고 있으면 초당 수십 번
 * 트리가 다시 그려진다. 맞추기 단계의 메인 스레드 예산은 120ms 이고(그걸 넘기면 H3로
 * 라운드가 점수 대신 보류가 된다), 그건 성능 문제가 아니라 **정확성 문제**다.
 * 그래서 시계로 움직이는 것은 전부 캔버스에, 상태가 바뀔 때만 움직이는 것은 React에 둔다.
 *
 * **금지:** `ctx.filter`. 경로마다 블러 패스를 돌려 433ms/프레임(2.8fps)이 되고 H3에 즉사한다.
 * 스켈레톤 2벌·파티클 400개·`shadowBlur` 는 실측상 프레임 예산에 변화가 없다(120.5fps 유지).
 */

export type GamePhase = "idle" | "present" | "ready" | "capture" | "verdict" | "done";

const COLORS = {
  fg: "#e9eff7",
  muted: "#a3b4c8",
  brand: "#7aa2f7",
  track: "rgba(255,255,255,0.12)",
  ok: "#56d98a",
  warn: "#f2c15b",
  bad: "#f78787",
  hold: "#c29bf5",
  back: "rgba(8,12,18,0.72)",
} as const;

const FONT = 'system-ui, -apple-system, "Apple SD Gothic Neo", sans-serif';

/* ── 효과 층 ─────────────────────────────────────────────────────────── */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  r: number;
}

/**
 * 플래시·파티클·링 펄스를 들고 있는 작은 층.
 *
 * 난수를 쓰지만 **판정에는 닿지 않는다** — 점수는 `Judgement` 하나에서만 나오고
 * 이 층은 화면만 만진다. `prefers-reduced-motion` 이면 스스로 아무것도 그리지 않는다.
 */
export class EffectLayer {
  private particles: Particle[] = [];
  private flashA = 0;
  private rings: { x: number; y: number; t: number; color: string }[] = [];
  private seed = 1;

  constructor(private reducedMotion = false) {}

  setReducedMotion(v: boolean): void {
    this.reducedMotion = v;
    if (v) this.clear();
  }

  clear(): void {
    this.particles = [];
    this.rings = [];
    this.flashA = 0;
  }

  /** 결정적 난수. 같은 순서로 부르면 같은 그림이 나온다. */
  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }

  flash(strength = 0.35): void {
    if (this.reducedMotion) return;
    this.flashA = Math.max(this.flashA, strength);
  }

  burst(x: number, y: number, count: number, color: string): void {
    if (this.reducedMotion) return;
    const n = Math.min(count, 400);
    for (let i = 0; i < n; i += 1) {
      const ang = this.rand() * Math.PI * 2;
      const sp = 60 + this.rand() * 320;
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 60,
        life: 0,
        max: 550 + this.rand() * 450,
        color,
        r: 1.5 + this.rand() * 3,
      });
    }
  }

  ring(x: number, y: number, color: string): void {
    if (this.reducedMotion) return;
    this.rings.push({ x, y, t: 0, color });
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, dtMs: number): void {
    if (this.reducedMotion) return;
    const dt = Math.min(dtMs, 64) / 1000;

    // 링 펄스
    this.rings = this.rings.filter((r) => r.t < 620);
    for (const r of this.rings) {
      r.t += dtMs;
      const u = r.t / 620;
      ctx.save();
      ctx.globalAlpha = (1 - u) * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3 * (1 - u) + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 10 + u * 46, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 파티클 — 회전·크기 없이 arc + globalAlpha 면 충분하다
    if (this.particles.length > 0) {
      ctx.save();
      for (const p of this.particles) {
        p.life += dtMs;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 520 * dt;
        const u = p.life / p.max;
        if (u >= 1) continue;
        ctx.globalAlpha = 1 - u;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      this.particles = this.particles.filter((p) => p.life < p.max);
    }

    // 플래시 — 전면 한 장. 비용 0.
    if (this.flashA > 0.004) {
      ctx.save();
      ctx.fillStyle = `rgba(255,255,255,${this.flashA.toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
      this.flashA *= Math.pow(0.0001, dt); // 약 6프레임에 사라진다
      if (this.flashA < 0.004) this.flashA = 0;
    }
  }
}

/* ── HUD ─────────────────────────────────────────────────────────────── */

export interface HudState {
  phase: GamePhase;
  roundNumber: number;
  roundCount: number;
  /** 준비 단계에서 남은 초(3·2·1). 그 외에는 null */
  countdown: number | null;
  /** 맞추기 단계에서 남은 ms */
  remainMs: number | null;
  limitMs: number;
  comboMultiplier: number;
  /** 판정 단계에서 보여 줄 기본점. 보류면 null */
  verdictBase: number | null;
  verdictWithheld: boolean;
  /** 판정 단계 진행도 0~1 (점수 튀어오름에 쓴다) */
  verdictProgress: number;
  poseName: string;
  cue: string;
}

function pill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "left",
): void {
  ctx.save();
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width;
  const px = align === "right" ? x - w - 20 : x;
  ctx.fillStyle = COLORS.back;
  roundRect(ctx, px - 10, y - size * 0.85, w + 20, size * 1.7, 999);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, px, y);
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

export function drawHud(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  hud: HudState,
): void {
  ctx.save();

  // 라운드 · 콤보
  if (hud.phase !== "idle" && hud.phase !== "done") {
    pill(ctx, `${hud.roundNumber} / ${hud.roundCount}`, 16, 28, 15, COLORS.fg);
    if (hud.comboMultiplier > 1.001) {
      pill(
        ctx,
        `콤보 ×${hud.comboMultiplier.toFixed(1)}`,
        width - 16,
        28,
        15,
        COLORS.warn,
        "right",
      );
    }
  }

  // 제시 — 자세 이름과 한 줄
  if (hud.phase === "present") {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLORS.back;
    roundRect(ctx, width * 0.08, height - 108, width * 0.84, 76, 14);
    ctx.fill();
    ctx.fillStyle = COLORS.brand;
    ctx.font = `800 26px ${FONT}`;
    ctx.fillText(hud.poseName, width / 2, height - 82);
    ctx.fillStyle = COLORS.muted;
    ctx.font = `500 15px ${FONT}`;
    ctx.fillText(hud.cue, width / 2, height - 52);
  }

  // 준비 — 3·2·1
  if (hud.phase === "ready" && hud.countdown !== null) {
    const n = hud.countdown;
    const frac = n - Math.floor(n);
    const digit = Math.max(1, Math.ceil(n));
    const pop = 1 + 0.35 * frac; // 1초마다 커졌다 작아진다
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.globalAlpha = 0.28 + 0.72 * (1 - frac);
    ctx.scale(pop, pop);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLORS.fg;
    ctx.font = `800 132px ${FONT}`;
    ctx.fillText(String(digit), 0, 0);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = COLORS.brand;
    ctx.lineWidth = 5;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 108, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - frac));
    ctx.stroke();
    ctx.restore();

    pill(ctx, "아직 기록하지 않습니다", width / 2 - 92, height / 2 + 148, 14, COLORS.muted);
  }

  // 맞추기 — 남은 시간 막대
  if (hud.phase === "capture" && hud.remainMs !== null) {
    const u = Math.max(0, Math.min(1, hud.remainMs / hud.limitMs));
    const barY = height - 34;
    const barX = 18;
    const barW = width - 36;
    ctx.fillStyle = COLORS.track;
    roundRect(ctx, barX, barY, barW, 12, 6);
    ctx.fill();
    ctx.fillStyle = u > 0.45 ? COLORS.ok : u > 0.2 ? COLORS.warn : COLORS.bad;
    roundRect(ctx, barX, barY, Math.max(barW * u, 4), 12, 6);
    ctx.fill();

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = COLORS.fg;
    ctx.font = `700 20px ${FONT}`;
    ctx.fillText(`${(hud.remainMs / 1000).toFixed(1)}초`, width / 2, barY - 10);
    pill(ctx, "기록 중", 16, height - 74, 14, COLORS.bad);
  }

  // 판정 — 점수가 튀어오른다
  if (hud.phase === "verdict") {
    const p = Math.min(1, hud.verdictProgress / 0.35);
    const ease = 1 - Math.pow(1 - p, 3);
    ctx.save();
    ctx.translate(width / 2, height / 2 - 18);
    ctx.scale(0.6 + 0.4 * ease, 0.6 + 0.4 * ease);
    ctx.globalAlpha = ease;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (hud.verdictWithheld || hud.verdictBase === null) {
      ctx.fillStyle = COLORS.hold;
      ctx.font = `800 62px ${FONT}`;
      ctx.fillText("보류", 0, 0);
      ctx.fillStyle = COLORS.muted;
      ctx.font = `500 17px ${FONT}`;
      ctx.fillText("점수를 지어내지 않습니다", 0, 52);
    } else {
      const shown = Math.round(hud.verdictBase * Math.min(1, hud.verdictProgress / 0.5));
      ctx.fillStyle =
        hud.verdictBase >= 90 ? COLORS.ok : hud.verdictBase >= 70 ? COLORS.brand : COLORS.warn;
      ctx.font = `800 104px ${FONT}`;
      ctx.fillText(String(shown), 0, 0);
      ctx.fillStyle = COLORS.muted;
      ctx.font = `600 18px ${FONT}`;
      ctx.fillText("기본점", 0, 64);
    }
    ctx.restore();
    pill(ctx, "가장 잘 맞은 2초를 되감는 중", 16, height - 30, 14, COLORS.muted);
  }

  ctx.restore();
}
