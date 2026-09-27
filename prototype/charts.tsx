/**
 * Charts, hand-rolled in SVG.
 *
 * No chart library: every figure here is a handful of rects and a path,
 * and a dependency that ships its own colours, fonts and tooltips would
 * have to be fought back into this design system anyway.
 *
 * The rules being followed (see the dataviz method):
 *   · ONE axis. Never two scales on one chart — money and counts get two
 *     charts, or one indexed to a common base.
 *   · Series colour follows the ENTITY and is assigned in fixed order,
 *     never cycled and never reassigned by rank.
 *   · Sequential means one hue, light to dark. Magnitude is not identity.
 *   · Status colours are reserved for status and never used as "series 4".
 *   · Text wears ink tokens; the coloured mark beside it carries identity.
 *   · Grid and axes recede; the data is the only thing at full strength.
 */

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)"];

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span className="legend-item" key={i.label}>
          <span className="legend-swatch" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Money over time against a target. Two series, so a legend is present;
 *  both are direct-labelled at the end, so identity is never colour alone. */
export function TrendChart({ data, height = 190 }: { data: { month: string; won: number; target: number }[]; height?: number }) {
  const w = 620, pad = { t: 14, r: 16, b: 26, l: 54 };
  const max = Math.max(...data.flatMap((d) => [d.won, d.target])) * 1.12;
  const iw = w - pad.l - pad.r, ih = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (iw / (data.length - 1)) * i;
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const line = (key: "won" | "target") => data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d[key])}`).join(" ");
  const ticks = [0, max / 2, max];

  return (
    <div>
      <Legend items={[{ label: "Won", color: SERIES[0]! }, { label: "Target", color: "var(--ink-4)" }]} />
      <svg viewBox={`0 0 ${w} ${height}`} className="chart" role="img" aria-label="Revenue won against target by month">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--rule)" strokeWidth="1" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="chart-tick">
              {t === 0 ? "0" : "₹" + (t / 100000).toFixed(0) + "L"}
            </text>
          </g>
        ))}
        {/* The target is a reference, so it is dashed and grey: it is not a
            second measure competing for attention, it is the bar to clear. */}
        <path d={line("target")} fill="none" stroke="var(--ink-4)" strokeWidth="2" strokeDasharray="5 4" />
        <path d={line("won")} fill="none" stroke={SERIES[0]} strokeWidth="2" strokeLinejoin="round" />
        {data.map((d, i) => (
          <circle key={d.month} cx={x(i)} cy={y(d.won)} r="4" fill={SERIES[0]} stroke="var(--surface)" strokeWidth="2" />
        ))}
        {data.map((d, i) => (
          <text key={d.month} x={x(i)} y={height - 8} textAnchor="middle" className="chart-tick">{d.month}</text>
        ))}
      </svg>
    </div>
  );
}

/** Counts falling through the stages. One series, so no legend — the title
 *  names it — and every bar is directly labelled with its count. */
export function FunnelChart({ data }: { data: { stage: string; count: number }[] }) {
  const max = data[0]?.count ?? 1;
  return (
    <div className="funnel">
      {data.map((d, i) => {
        const pct = (d.count / max) * 100;
        const drop = i === 0 ? null : Math.round((1 - d.count / (data[i - 1]!.count || 1)) * 100);
        return (
          <div className="funnel-row" key={d.stage}>
            <div className="funnel-label">{d.stage}</div>
            <div className="funnel-track">
              {/* Magnitude is one hue, light to dark — not five identities. */}
              <div className="funnel-bar" style={{ width: pct + "%", background: `var(--ramp-${Math.min(5, i + 1)})` }} />
            </div>
            <div className="funnel-count">{d.count}</div>
            <div className="funnel-drop">{drop === null ? "" : `−${drop}%`}</div>
          </div>
        );
      })}
    </div>
  );
}

/** A ranked comparison of one measure. Bars, because length is the thing
 *  people compare accurately; one hue, because rank is not identity. */
export function BarList({ data, format }: { data: { label: string; value: number }[]; format?: (n: number) => string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="barlist">
      {data.map((d) => (
        <div className="barlist-row" key={d.label}>
          <div className="barlist-label">{d.label}</div>
          <div className="barlist-track">
            <div className="barlist-bar" style={{ width: (d.value / max) * 100 + "%" }} />
          </div>
          <div className="barlist-value">{format ? format(d.value) : d.value}</div>
        </div>
      ))}
    </div>
  );
}

/** Progress to a single target. Not a chart — one number with a bar under
 *  it, which is what a single value against a goal actually needs. */
export function TargetMeter({ achieved, target, label }: { achieved: number; target: number; label?: string }) {
  const pct = Math.min(100, Math.round((achieved / Math.max(target, 1)) * 100));
  const tone = pct >= 100 ? "good" : pct >= 70 ? "accent" : "warn";
  return (
    <div className="target">
      <div className="target-line">
        <span className="target-pct">{pct}%</span>
        {label ? <span className="target-label">{label}</span> : null}
      </div>
      <div className="target-track"><div className={"target-fill is-" + tone} style={{ width: pct + "%" }} /></div>
    </div>
  );
}

/** A tiny bar per stage, for a row in a table. Sparkline-ish: no axis, no
 *  labels, read as a shape rather than as values. */
export function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <span className="minibars" aria-hidden="true">
      {values.map((v, i) => <span key={i} className="minibar" style={{ height: Math.max(2, (v / max) * 18) + "px" }} />)}
    </span>
  );
}
