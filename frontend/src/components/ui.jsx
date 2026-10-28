import React from "react";

/** "?" badge. The explanation shows on hover AND keyboard focus (CSS, from data-tip). */
export function Info({ text }) {
  return <button type="button" className="info" data-tip={text} aria-label={text}>?</button>;
}

/**
 * Loading / error / empty wrapper. While a refetch is in flight the previous render stays
 * on screen, dimmed, so the layout never jumps.
 */
export function State({ q, empty, children }) {
  if (q.loading && !q.data) return <div className="state"><span className="spinner" aria-hidden /> Loading data…</div>;
  if (q.error) return <div className="state err" role="alert">Could not load data from the API ({q.error.message}). Please retry shortly.</div>;
  if (empty) return <div className="state">{empty}</div>;
  return <div className={q.loading ? "stale" : ""} aria-busy={q.loading}>{children}</div>;
}

/** Segmented control (resolution, zoom range, table tabs). */
export function Segmented({ value, onChange, options, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" className={v === value ? "on" : ""} aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** A page section: eyebrow + title, separated from the next by a hairline instead of a boxed card. */
export function Section({ eyebrow, title, lede, actions, children, id }) {
  return (
    <section className="sec" id={id} aria-labelledby={id ? `${id}-t` : undefined}>
      <div className="sec-head">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h2 id={id ? `${id}-t` : undefined}>{title}</h2>
          {lede && <p className="lede">{lede}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
