import type { MailFolder } from "../../data/mail";

export interface ShownFolder {
  /** What the API is asked for. A well-known name for the standard folders,
   *  so it keeps working in a mailbox whose display names are not English;
   *  the folder's id for everything else. */
  key: string;
  label: string;
  unread: number;
}

/**
 * The order a mail client shows folders in.
 *
 * Not alphabetical and not the order Graph returns, which is neither. Inbox,
 * then the places mail you wrote goes, then the bins — the order has been
 * stable across mail clients long enough that anything else reads as broken.
 *
 * WELL-KNOWN NAMES, NOT DISPLAY NAMES, for the standard folders. Graph
 * accepts `inbox`, `sentitems`, `drafts`, `deleteditems` and `archive` in
 * any mailbox, while the display name is localised — so a mailbox set to
 * another language would otherwise have a sidebar whose labels are right and
 * whose clicks fetch nothing.
 */
const WELL_KNOWN: { key: string; label: string; match: string[] }[] = [
  { key: "inbox", label: "Inbox", match: ["inbox"] },
  { key: "drafts", label: "Drafts", match: ["drafts"] },
  { key: "sentitems", label: "Sent", match: ["sent items", "sent"] },
  { key: "archive", label: "Archive", match: ["archive"] },
  { key: "junkemail", label: "Junk", match: ["junk email", "junk"] },
  { key: "deleteditems", label: "Deleted", match: ["deleted items", "deleted", "trash"] },
];

const STANDARD = new Set(WELL_KNOWN.flatMap((f) => f.match));

export function foldersInOutlookOrder(folders: readonly MailFolder[]): ShownFolder[] {
  const byName = new Map(folders.map((f) => [f.name.trim().toLowerCase(), f]));

  const standard = WELL_KNOWN.map(({ key, label, match }) => {
    const found = match.map((m) => byName.get(m)).find(Boolean);
    return { key, label, unread: found?.unread ?? 0, present: !!found };
  })
    /* Inbox always shows, even before the folder list has arrived — it is
       what the screen opens on, and a sidebar that is empty for a moment
       looks like a mailbox with no folders. */
    .filter((f) => f.present || f.key === "inbox")
    .map(({ key, label, unread }) => ({ key, label, unread }));

  /* Everything the person made themselves, alphabetically, under the rest.
     Addressed by id: a custom folder has no well-known name. */
  const custom = folders
    .filter((f) => !STANDARD.has(f.name.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => ({ key: f.id, label: f.name, unread: f.unread }));

  return [...standard, ...custom];
}
