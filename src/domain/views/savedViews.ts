/**
 * A filter combination somebody wants back tomorrow.
 *
 * Every list screen in this CRM filters by the same shape — a handful of
 * named strings — so saving one is saving that object under a name. The
 * logic lives here, away from the screens, because "is what I am looking at
 * already saved" is the part that is easy to get subtly wrong and invisible
 * when it is: a view that never matches offers Save forever, and one that
 * always matches never offers it at all.
 *
 * PERSONAL, NOT SHARED. These live in the browser, so they are one person's
 * working habits and not a company-wide definition of "open deals". A saved
 * view that silently became everyone's would be a different feature with a
 * different blast radius, and it would need a table.
 */

export interface SavedView {
  id: string;
  name: string;
  /** The filter state, exactly as the screen holds it. */
  filters: Record<string, string>;
}

/**
 * What a screen calls "no filter".
 *
 * Empty and "all" are the common cases, but not every screen starts
 * unfiltered at "all": the payment tracker opens on pending bills, because
 * a list of every bill ever paid is not what anybody opens it for. A screen
 * like that declares its own resting state here, otherwise its untouched
 * list looks filtered — Save on offer forever for a view that is just the
 * screen as it opens.
 */
export type ViewDefaults = Record<string, string>;

/** A filter at its default is the same as a filter nobody set. */
const meaningful = (
  filters: Record<string, string>,
  defaults: ViewDefaults = {},
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters ?? {})) {
    const v = String(value ?? "").trim();
    if (!v) continue;
    /* A declared default replaces the "all" convention rather than adding to
       it. On the payment tracker "all" means every bill including the paid
       ones, which is a narrower-to-wider move away from the default and so
       very much worth saving. */
    if (key in defaults) {
      if (v === String(defaults[key] ?? "").trim()) continue;
    } else if (v === "all") continue;
    out[key] = v;
  }
  return out;
};

/** True when the screen is already showing this view. */
export function matchesCurrent(
  view: SavedView,
  current: Record<string, string>,
  defaults: ViewDefaults = {},
): boolean {
  const a = meaningful(view.filters, defaults);
  const b = meaningful(current, defaults);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

/** The saved view the screen is currently showing, if any. */
export const activeView = (
  views: readonly SavedView[],
  current: Record<string, string>,
  defaults: ViewDefaults = {},
): SavedView | null =>
  views.find((v) => matchesCurrent(v, current, defaults)) ?? null;

/** Nothing worth saving — every filter is at its default. */
export const isDefaultView = (current: Record<string, string>, defaults: ViewDefaults = {}): boolean =>
  Object.keys(meaningful(current, defaults)).length === 0;

/**
 * Add a view, or replace one of the same name.
 *
 * Same name replaces rather than duplicating: somebody saving "Open deals"
 * twice means they changed their mind about what it is, not that they want
 * two entries that look identical and behave differently.
 */
export function saveView(
  views: readonly SavedView[],
  name: string,
  filters: Record<string, string>,
  defaults: ViewDefaults = {},
): SavedView[] {
  const clean = name.trim();
  if (!clean) return [...views];
  const view: SavedView = {
    id: views.find((v) => v.name.toLowerCase() === clean.toLowerCase())?.id
      ?? `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: clean,
    filters: meaningful(filters, defaults),
  };
  const without = views.filter((v) => v.name.toLowerCase() !== clean.toLowerCase());
  return [...without, view];
}

export const removeView = (views: readonly SavedView[], id: string): SavedView[] =>
  views.filter((v) => v.id !== id);

/** Reading what was stored, defensively: it came from localStorage, which
 *  anything may have written to and an old version certainly did. */
export function readViews(raw: unknown): SavedView[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is SavedView =>
      !!v && typeof v === "object"
      && typeof (v as SavedView).id === "string"
      && typeof (v as SavedView).name === "string"
      && !!(v as SavedView).filters && typeof (v as SavedView).filters === "object")
    .map((v) => ({ id: v.id, name: v.name, filters: meaningful(v.filters) }));
}
