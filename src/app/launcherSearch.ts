import { NAV, type NavSection } from "./nav";

/**
 * What the App Launcher shows for what somebody has typed.
 *
 * SEPARATE FROM THE COMPONENT so the matching can be tested without a
 * browser. A launcher that quietly stops finding "Purchase orders" is
 * the kind of fault nobody reports — they just go back to the rail and
 * decide the search box does not work.
 */

export interface LauncherSection {
  label: string;
  items: { id: string; label: string }[];
}

/**
 * Not offered as a destination.
 *
 * The component gallery is a developer page. It was already filtered out
 * of the launcher before the search existed; it is named here so there
 * is one list rather than the same string tested in three places.
 */
const HIDDEN = new Set(["components"]);

/**
 * The sections and items matching `query`.
 *
 * EVERY TERM MUST MATCH, and a term may match either the item or the
 * section it is in. That makes "pur ord" find Purchase orders without
 * anybody typing it exactly, and "deliver" list the whole Deliver group
 * — somebody who knows the shape of the business but not the name of
 * the screen still gets there.
 *
 * A SECTION WITH NOTHING LEFT IN IT IS DROPPED, rather than shown empty
 * under its heading. Eight headings over one result reads as a broken
 * search.
 */
export function filterNav(query: string, sections: readonly NavSection[] = NAV): LauncherSection[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const out: LauncherSection[] = [];
  for (const sec of sections) {
    const items = sec.items
      .filter((i) => !HIDDEN.has(i.id))
      .filter((i) => {
        if (!terms.length) return true;
        const hay = `${i.label} ${sec.label}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .map((i) => ({ id: i.id, label: i.label }));
    if (items.length) out.push({ label: sec.label, items });
  }
  return out;
}

/**
 * Where Enter goes: the first destination on screen, or nothing.
 *
 * It reads the FILTERED list rather than searching again, so the key
 * cannot open something the person is not looking at.
 */
export function firstMatch(sections: readonly LauncherSection[]): string | null {
  return sections[0]?.items[0]?.id ?? null;
}
