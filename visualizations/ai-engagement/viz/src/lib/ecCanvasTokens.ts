/**
 * Bridges the EC CSS custom properties (styles/ec-tokens.css) into Canvas2D
 * draw calls, which can't read `var(--…)` themselves. A canvas-drawing
 * component reads this once on mount and again whenever the resolved
 * light/dark theme flips, so its module-level color constants stay a
 * single source of truth with the DOM rather than a second hardcoded copy.
 */

export interface EcCanvasTokens {
  surface: string;
  onSurface: string;
  onSurfaceMuted: string;
  hairline: string;
  emphasis: string;
  link: string;
  nondata: string;
  dropped: string;
  graphicHairline: string;
}

const TOKEN_VARS: Record<keyof EcCanvasTokens, string> = {
  surface: "--ec-surface",
  onSurface: "--ec-on-surface",
  onSurfaceMuted: "--ec-on-surface-muted",
  hairline: "--ec-hairline",
  emphasis: "--ec-emphasis",
  link: "--ec-link",
  nondata: "--ec-nondata",
  dropped: "--ec-dropped",
  graphicHairline: "--ec-graphic-hairline",
};

/**
 * Resolves every EC semantic token against `el`'s computed style.
 *
 * Deliberately NOT `getComputedStyle(el).getPropertyValue('--ec-…')` — every
 * semantic token in ec-tokens.css is itself defined as `var(--ec-navy)` etc
 * (chained through to the raw brand hues), and per the CSS Custom
 * Properties spec, reading a custom property directly returns its
 * specified token stream, not a var()-substituted value: `getPropertyValue`
 * on a chained custom property gives back the literal string
 * `"var(--ec-navy)"`, not `"#1c2745"`. Substitution only happens when a
 * *standard* property (color, background-color, …) is computed. So this
 * assigns each token to a detached probe element's `color` and reads that
 * back instead, which the browser does fully resolve — down to an rgb()
 * string, parsed by the callers' own toRGB() (extended to accept rgb()
 * alongside hex, see ParticipantFunnelCloud.svelte). Called only on mount
 * and on theme flips, never per animation frame, so the extra style
 * recalculation per token is negligible.
 *
 * The probe is appended under `el`'s own parent, NOT document.body — a
 * caller whose tokens are overridden partway down the tree (e.g.
 * DiscussionSection.svelte's `.viz-root.white-surface`, which pins
 * --ec-surface to white regardless of the page's own light/dark tokens)
 * needs the probe to inherit that same override, which it only does by
 * sitting inside the same subtree `el` renders in. Falls back to
 * document.body only if `el` isn't attached yet.
 */
export function readEcTokens(el: Element): EcCanvasTokens {
  const doc = el.ownerDocument;
  const probe = doc.createElement("span");
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  (el.parentElement ?? doc.body ?? doc.documentElement).appendChild(probe);
  try {
    const resolve = (varName: string): string => {
      probe.style.color = `var(${varName})`;
      return getComputedStyle(probe).color;
    };
    const out = {} as EcCanvasTokens;
    for (const key of Object.keys(TOKEN_VARS) as (keyof EcCanvasTokens)[]) {
      out[key] = resolve(TOKEN_VARS[key]);
    }
    return out;
  } finally {
    probe.remove();
  }
}

/**
 * Calls `cb` with freshly-resolved tokens now, and again whenever the
 * resolved light/dark theme could have changed: a `prefers-color-scheme`
 * flip, or a `data-theme` attribute change on <html> (the manual override
 * every other themed component in viz/ already supports — see
 * Beeswarm.svelte/App.svelte). Returns a teardown function for onDestroy.
 */
export function watchEcTokens(el: Element, cb: (tokens: EcCanvasTokens) => void): () => void {
  const fire = () => cb(readEcTokens(el));
  fire();

  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", fire);

  const observer = new MutationObserver(fire);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  return () => {
    media.removeEventListener("change", fire);
    observer.disconnect();
  };
}
