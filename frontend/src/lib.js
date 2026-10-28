import { useEffect, useRef, useState } from "react";

// Same origin in production (Vercel / Docker) and via the Vite proxy in dev.
export const api = (path, params = {}) =>
  fetch(`/api/${path}?${new URLSearchParams(params)}`).then((r) => {
    if (!r.ok) throw new Error(`API ${r.status}`);
    return r.json();
  });

/** Fetch helper: re-runs when `params` change; exposes loading and error state. */
export function useApi(path, params) {
  const [state, set] = useState({ data: null, error: null, loading: true });
  const key = JSON.stringify(params);
  useEffect(() => {
    let live = true;
    set((s) => ({ ...s, error: null, loading: true }));
    api(path, params).then(
      (data) => live && set({ data, error: null, loading: false }),
      (error) => live && set({ data: null, error, loading: false }),
    );
    return () => { live = false; };
  }, [path, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

// ---- formatting (one place, so units and number formats stay consistent) ----
export const fmt = (n) => Math.round(n).toLocaleString("en-GB");
export const fmtSigned = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));
export const hhmm = (iso) => iso.slice(11, 16);
const dateFmt = { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" };
export const fmtDate = (d) => d.toLocaleDateString("en-GB", dateFmt);
/** ISO string "2026-01-14T09:00:00Z" -> "14 Jan 09:00 UTC" */
export const fmtStamp = (iso) =>
  `${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} ${hhmm(iso)} UTC`;

export const DAYS = Array.from({ length: 31 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);

/** Decision time shown before the API answers: `cutoff` UTC on the day before `day`. */
export function decisionDate(day, cutoff) {
  const d = new Date(`${day}T${cutoff}:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

// Plain-English definitions (tooltips and KPI captions).
export const HELP = {
  mae: "Mean Absolute Error: the average size of the miss, ignoring direction. Lower is better.",
  rmse: "Root Mean Squared Error: like MAE but big misses count extra. Always at least as large as MAE.",
  bias: "Average of (forecast − actual). Positive: forecast above actual on average. Negative: below.",
  maePct: "MAE divided by the average actual generation. Lets you compare errors across periods of different wind output.",
  within: "Share of hours where the absolute forecast error was at or below the chosen threshold.",
  p90: "90th percentile of the absolute error: in 9 of 10 hours the forecast was within this many MW of actual.",
  worst: "The single largest absolute error in any hour.",
  band: "The range that contains the middle 80% of the hourly forecast errors (forecast − actual): 10% of hours were below the lower value and 10% above the upper value.",
  lead: "Forecast lead time: hours between when the forecast was published and the hour it predicts.",
};

/**
 * Smoothly animates a number towards `target` (about half a second). Returns the target
 * immediately when the user prefers reduced motion, or when there is nothing to animate from.
 */
export function useCountUp(target, ms = 550) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || target == null || from.current == null || from.current === target) { from.current = target; setValue(target); return undefined; }
    const start = performance.now(), a = from.current;
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3); // ease-out
      setValue(a + (target - a) * e);
      if (t < 1) raf = requestAnimationFrame(tick); else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = target; };
  }, [target, ms]);
  return value;
}

/**
 * The selected forecast hours of a /api/forecast response: { startTime, publishTime, generation, horizon_h }.
 * Uses `forecast_hours` when present and falls back to the forecast/actual pairs otherwise.
 */
export function forecastHoursOf(data) {
  if (!data) return [];
  if (data.forecast_hours) return data.forecast_hours;
  return (data.points ?? []).map((p) => ({ startTime: p.startTime, publishTime: p.publishTime, generation: p.forecast, horizon_h: p.horizon_h }));
}

/** "1 hour", "2 hours": the count with a correctly pluralised noun. */
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
