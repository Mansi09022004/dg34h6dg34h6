import React from "react";
import { fmtStamp } from "../lib.js";

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden>
      <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2563eb" /><stop offset="1" stopColor="#10b981" /></linearGradient></defs>
      <rect width="32" height="32" rx="7" fill="url(#lg)" />
      <g stroke="#fff" strokeWidth="2" strokeLinecap="round" fill="none"><path d="M16 16V6.5M16 16l8.2 4.7M16 16l-8.2 4.7" /></g>
      <circle cx="16" cy="16" r="2.2" fill="#fff" />
    </svg>
  );
}

/**
 * Abstract wind-flow background: thin streaks drifting slowly left to right behind the headline.
 * Purely decorative (aria-hidden); motion is disabled under prefers-reduced-motion.
 */
function Flow() {
  const lines = Array.from({ length: 13 }, (_, i) => {
    const y = 30 + i * 26;
    const a = 18 + (i % 4) * 9;
    return { d: `M-60 ${y} C 220 ${y - a}, 470 ${y + a}, 720 ${y} S 1150 ${y - a}, 1280 ${y + a / 2}`, delay: -(i * 3.1), dur: 38 + (i % 5) * 7, op: 0.16 + (i % 3) * 0.09 };
  });
  return (
    <svg className="flow" viewBox="0 0 1200 380" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="fl" x1="0" x2="1"><stop offset="0" stopColor="#3b82f6" stopOpacity="0" /><stop offset=".5" stopColor="#3b82f6" /><stop offset="1" stopColor="#10b981" stopOpacity="0" /></linearGradient>
      </defs>
      {lines.map((l, i) => (
        <path key={i} d={l.d} className="streak" stroke="url(#fl)" strokeOpacity={l.op} style={{ animationDuration: `${l.dur}s`, animationDelay: `${l.delay}s` }} />
      ))}
    </svg>
  );
}

/**
 * The first screen: a short, steady headline. Nothing here depends on the chosen day;
 * the day's forecast numbers sit right beside the controls and the chart further down.
 */
export function Hero({ meta, fc, compact }) {
  const fetched = meta.data?.fetched_at_utc;
  const bad = meta.error || fc.error;
  const c = fc.data?.coverage;
  return (
    <div className={`hero ${compact ? "compact" : ""}`}>
      <Flow />
      <div className="topbar">
        <div className="brandmark"><Logo /><span>Wind Forecast Desk</span></div>
        <ul className="meta" aria-label="Data information">
          <li><span>Source</span>Elexon BMRS · FUELHH · WINDFOR</li>
          <li><span>Data snapshot</span>{fetched ? fmtStamp(fetched) : "unknown"}</li>
          <li className={bad ? "bad" : "ok"}><i aria-hidden />{bad ? "Data unavailable" : fc.loading && !fc.data ? "Loading…" : c ? `Snapshot loaded · ${c.matched_hours}/${c.expected_hours} h matched` : "Snapshot loaded"}</li>
        </ul>
      </div>

      {!compact && (
        <div className="hero-body">
          <div className="hero-copy">
            <div className="eyebrow">Know your wind position before delivery · GB national wind · January 2026</div>
            <h1>The wind forecast for your delivery day.</h1>
            <p className="standfirst">Choose a delivery day and an assumed decision time to see the forecast that was available when the purchase had to be decided.</p>
          </div>
        </div>
      )}
    </div>
  );
}
