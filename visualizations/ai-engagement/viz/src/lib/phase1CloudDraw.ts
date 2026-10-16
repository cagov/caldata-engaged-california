/**
 * Shared canvas draw routine for the placeholder Phase 1 concept cloud —
 * used by both PhaseOneConceptCloud.svelte (a single static call at p=0)
 * and PhaseDistillationFinale.svelte (called every animation frame with an
 * advancing p). Kept out of phase1Cloud.ts so that module stays pure and
 * DOM-free/unit-testable; this file is the deliberate exception, shared
 * between the two components specifically so they can never visually drift
 * apart from each other.
 *
 * Color follows ParticipantFunnelCloud.svelte's own dev-only "Engaged"/
 * "ODI" palette-review toggle (`paletteVersion`) — both components thread
 * that same value down as a prop, so the concept cloud's colors always
 * match whichever ramp the rest of the view is currently reviewing.
 */
import { PHASE1_SUBTHEMES } from "./phase1ConceptsData.ts";
import { childProgress, computeAbsorption, parentFontSize, FIELD_TOP, LAYOUT, type Phase1CloudLayout } from "./phase1Cloud.ts";
import { CANVAS } from "./funnelCloud.ts";
import { DATA_VIZ_CAT_OLD_TEXT, DATA_VIZ_CAT_V2_TEXT } from "./palette.ts";

const WORD_FONT = "'Noto Sans', Arial, sans-serif";
const LINE_HEIGHT_EM = 1.22;

function colorForSubtheme(subtheme: number, paletteVersion: "engaged" | "odi"): string {
  const ramp = paletteVersion === "odi" ? DATA_VIZ_CAT_OLD_TEXT : DATA_VIZ_CAT_V2_TEXT;
  return ramp[subtheme];
}

function drawScaledLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  home: [number, number],
  refFS: number,
  scale: number,
  color: string,
  weight: string,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(home[0], home[1]);
  ctx.scale(scale, scale);
  ctx.font = `${weight} ${refFS}px ${WORD_FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * refFS * LINE_HEIGHT_EM));
  ctx.restore();
}

/** A flat list of the 8 real subthemes (verified against the
 * source-of-truth spreadsheet's own Subtheme column — see
 * phase1ConceptsData.ts's header comment) — no theme-level grouping, per
 * an explicit design decision: the theme headers made the legend read as
 * "3 categories" at a glance even though every word is actually colored by
 * one of the 8 subthemes underneath. */
function drawLegend(ctx: CanvasRenderingContext2D, textColor: string, paletteVersion: "engaged" | "odi"): void {
  const SW = 9,
    GAP = 7,
    PAD = 22;
  const rowYs = [LAYOUT.H - 95, LAYOUT.H - 65];
  const rows = [PHASE1_SUBTHEMES.slice(0, 4), PHASE1_SUBTHEMES.slice(4, 8)];

  ctx.textBaseline = "middle";
  ctx.font = `400 12px ${WORD_FONT}`;

  rows.forEach((row, ri) => {
    const widths = row.map((s) => SW + GAP + ctx.measureText(s.shortName).width + PAD);
    const totalW = widths.reduce((a, b) => a + b, 0) - PAD;
    let x = (LAYOUT.W - totalW) / 2;
    const y = rowYs[ri];

    row.forEach((s, i) => {
      const subthemeIndex = ri * 4 + i;
      ctx.beginPath();
      ctx.arc(x + SW / 2, y, SW / 2, 0, Math.PI * 2);
      ctx.fillStyle = colorForSubtheme(subthemeIndex, paletteVersion);
      ctx.fill();
      ctx.fillStyle = textColor;
      ctx.textAlign = "left";
      ctx.fillText(s.shortName, x + SW + GAP, y);
      x += widths[i];
    });
  });
}

/** Draws the placeholder Phase 1 cloud at progress `p` (0 = Phase 1 at
 * rest, 1 = fully distilled into Phase 2) into `ctx`. `ctx`'s canvas is
 * assumed to already be transformed to this app's shared CANVAS.W x
 * CANVAS.H coordinate space (see funnelCloud.ts's CANVAS and each
 * consuming component's own resize()) — this function applies one more
 * ctx.scale() on top of that to map phase1Cloud.ts's own LAYOUT space onto
 * it (see phase1Cloud.ts's header comment for why the two spaces differ).
 * Never paints above FIELD_TOP, leaving the header band transparent so the
 * funnel-cloud's own canvas-drawn header (COPY[stage], drawn underneath by
 * ParticipantFunnelCloud.svelte's header()) shows through unobstructed. */
export function drawPhase1Cloud(
  ctx: CanvasRenderingContext2D,
  layout: Phase1CloudLayout,
  p: number,
  surface: string,
  textColor: string,
  paletteVersion: "engaged" | "odi",
): void {
  ctx.clearRect(0, 0, CANVAS.W, CANVAS.H);

  ctx.save();
  ctx.scale(CANVAS.W / LAYOUT.W, CANVAS.H / LAYOUT.H);

  ctx.fillStyle = surface;
  ctx.fillRect(0, FIELD_TOP, LAYOUT.W, LAYOUT.H - FIELD_TOP);

  for (const c of layout.children) {
    const cp = childProgress(c.delay, p);
    if (cp >= 1) continue;
    const par = layout.parents[c.parent];
    const x = par.home[0] * cp + c.home[0] * (1 - cp);
    const y = par.home[1] * cp + c.home[1] * (1 - cp);
    const scale = 1 - 0.6 * cp;
    const alpha = 1 - Math.pow(cp, 2.6);
    drawScaledLines(ctx, c.lines, [x, y], c.refFS, scale, colorForSubtheme(c.subtheme, paletteVersion), "400", alpha * 0.92);
  }

  const acc = computeAbsorption(layout, p);
  layout.parents.forEach((par, i) => {
    if (acc[i] <= 0) return;
    const frac = Math.min(1, acc[i] / par.total);
    const fs = parentFontSize(par.w01 * frac);
    const scale = fs / par.refFS;
    const alpha = Math.min(1, frac * 1.7);
    // "400", not the heavier "600" this used to draw at — see
    // phase1Cloud.ts's SHARED_SIZE_MIN/RANGE comment: matching children's
    // own weight, on top of now matching their size range, is what makes a
    // fully-absorbed parent read as "one more word in the same cloud"
    // rather than something that grew to fill the space its missing
    // siblings left behind.
    drawScaledLines(ctx, par.lines, par.home, par.refFS, scale, colorForSubtheme(par.subtheme, paletteVersion), "400", alpha);
  });

  drawLegend(ctx, textColor, paletteVersion);

  ctx.restore();
}
