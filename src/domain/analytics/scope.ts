/**
 * Who sees what.
 *
 * Row-level security is the real boundary — a Sales user's queries never
 * return another salesperson's rows. This mirrors that rule in the client so
 * a screen cannot accidentally total records the database would have
 * withheld, and so an Admin's own view can be narrowed deliberately.
 *
 * It is NOT a security control. Never treat it as one: if this were the only
 * thing standing between a user and someone else's data, the data would
 * already be on their machine.
 */
export type Role = "Admin" | "Manager" | "Sales" | "Accounts";

export interface Owned {
  ownerId?: string;
}

export const seesEverything = (role: string): boolean =>
  role === "Admin" || role === "Manager" || role === "Accounts";

/** Narrow a list to what this user is entitled to see. */
export function scopeTo<T extends Owned>(rows: readonly T[], user: { id: string; role: string }): T[] {
  if (seesEverything(user.role)) return [...rows];
  return rows.filter((r) => r.ownerId === user.id);
}
