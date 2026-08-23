import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/* The shared component library. Presentational only — nothing here reaches
   for domain logic or data. Every visual decision resolves to a token. */

const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(" ");

/* ── button ────────────────────────────────────────────────────────── */
export type ButtonTone = "primary" | "default" | "quiet" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  size?: "sm" | "md" | "lg";
  iconOnly?: boolean;
}

export function Button({ tone = "default", size = "md", iconOnly, className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx("btn", `btn-${tone}`, size === "sm" && "btn-sm", size === "lg" && "btn-lg", iconOnly && "btn-icon", className)}
      {...rest}
    />
  );
}

/* ── field ─────────────────────────────────────────────────────────────
   Label, control, and — when something is wrong — a message that says what
   to do about it rather than restating the failure. */
export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  /** Shown in place of the hint. Phrase as an instruction. */
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, htmlFor, children }: FieldProps) {
  return (
    <div>
      {label ? <label className="label" htmlFor={htmlFor}>{label}</label> : null}
      {children}
      {error ? <div className="field-msg">{error}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** Right-aligned, monospaced, tabular — for money and quantities. */
  numeric?: boolean;
}
export function Input({ invalid, numeric, className, ...rest }: InputProps) {
  return <input className={cx("input", numeric && "input-num", invalid && "field-error", className)} {...rest} />;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> { invalid?: boolean }
export function Select({ invalid, className, ...rest }: SelectProps) {
  return <select className={cx("select", invalid && "field-error", className)} {...rest} />;
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> { invalid?: boolean }
export function Textarea({ invalid, className, ...rest }: TextareaProps) {
  return <textarea className={cx("textarea", invalid && "field-error", className)} {...rest} />;
}

/* ── card ──────────────────────────────────────────────────────────────
   `edge` marks a card that needs action, with a coloured left rule. It is
   structural: it reads down a column of cards at a glance, and it does not
   spend colour on anything that is merely fine. */
export type Tone = "neutral" | "good" | "warn" | "bad" | "accent";

export interface CardProps {
  title?: ReactNode;
  actions?: ReactNode;
  edge?: Exclude<Tone, "neutral">;
  padded?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Card({ title, actions, edge, padded = true, className, children }: CardProps) {
  return (
    <section className={cx("card", edge && "edge", edge && `edge-${edge}`, className)}>
      {title || actions ? (
        <header className="card-head">
          <span className="card-title">{title}</span>
          {actions ? <span className="row-tight">{actions}</span> : null}
        </header>
      ) : null}
      <div className={padded ? "card-pad" : undefined}>{children}</div>
    </section>
  );
}

/* ── stat tile ─────────────────────────────────────────────────────── */
export interface StatTileProps {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  /** Colours the figure. Use only when the number itself carries a state. */
  tone?: Exclude<Tone, "accent" | "neutral">;
  onClick?: () => void;
}

export function StatTile({ label, value, meta, tone, onClick }: StatTileProps) {
  const body = (
    <>
      <div className="tile-label">{label}</div>
      <div className={cx("tile-value", tone && `is-${tone}`)}>{value}</div>
      {meta ? <div className="tile-meta">{meta}</div> : null}
    </>
  );
  if (!onClick) return <div className="tile">{body}</div>;
  return <button type="button" className="tile" onClick={onClick}>{body}</button>;
}

/**
 * The headline figures, read as one instrument divided by hairlines rather
 * than as a row of floating cards. Columns are set here so the dividing
 * rules land correctly when it wraps.
 */
export function SummaryBar({ children, columns }: { children: ReactNode; columns: number }) {
  /* The count travels as a custom property, not as an inline
     grid-template-columns. An inline declaration wins over every media
     query, which pinned five columns onto a 390px phone and wrapped every
     figure mid-value. */
  return (
    <div className="summary" style={{ "--summary-cols": columns } as CSSProperties}>
      {children}
    </div>
  );
}

/* ── chip ──────────────────────────────────────────────────────────────
   State only. A chip that means nothing is noise, and it dilutes the ones
   that do. The dot carries the state for anyone who cannot separate hues. */
export interface ChipProps {
  tone?: Tone;
  dot?: boolean;
  /** Tinted background. Reserve it for where a state is the subject of the
   *  screen — down a status column, forty tinted lozenges are the loudest
   *  thing on the page and none of them means more than the others. */
  solid?: boolean;
  children: ReactNode;
}
export function Chip({ tone = "neutral", dot = true, solid = false, children }: ChipProps) {
  return (
    <span className={cx("chip", `chip-${tone}`, solid && "chip-solid")}>
      {dot ? <span className="chip-dot" /> : null}
      {children}
    </span>
  );
}

/* ── tabs ──────────────────────────────────────────────────────────── */
export interface TabsProps<T extends string> {
  tabs: { id: T; label: string; count?: number }[];
  active: T;
  onChange: (id: T) => void;
}
export function Tabs<T extends string>({ tabs, active, onChange }: TabsProps<T>) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={t.id === active}
          className="tab"
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count !== undefined ? <span className="tab-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ── empty state ───────────────────────────────────────────────────── */
export interface EmptyProps { title: string; body?: ReactNode; action?: ReactNode }
export function Empty({ title, body, action }: EmptyProps) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {body ? <div className="empty-body">{body}</div> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

/* ── meter ─────────────────────────────────────────────────────────── */
export function Meter({ pct, tone }: { pct: number; tone?: Exclude<Tone, "neutral" | "accent"> }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="meter" role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx("meter-fill", tone && `is-${tone}`)} style={{ width: clamped + "%" }} />
    </div>
  );
}

export { cx };
