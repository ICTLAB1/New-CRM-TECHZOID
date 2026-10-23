/**
 * Whether a collapsed group of fields is holding anything.
 *
 * THE RULE THIS EXISTS TO ENFORCE: a form may hide a field nobody fills in,
 * and must never hide a field somebody already filled in. Those are two
 * different things and it is the second one that goes wrong quietly — a
 * website on file, a delivery contact, an alternate number, all sitting
 * behind a collapsed toggle on a record somebody is editing, invisible and
 * therefore wrong as far as they can tell. They retype it, or they conclude
 * the CRM lost it.
 *
 * So a group opens itself when any of its fields has a value. Progressive
 * disclosure is for the empty case only.
 */

/** A value a form field can hold, as the screens actually hold them. */
export type FieldValue = string | number | boolean | null | undefined;

/** True when this one value counts as filled in. */
export function filled(value: FieldValue): boolean {
  if (value === null || value === undefined) return false;
  /* A number is data even when it is zero — a nil-rated line, a zero
     advance. Blank is what `undefined` is for. */
  if (typeof value === "number") return Number.isFinite(value);
  /* A box that is ticked is an answer; an unticked one is the default and
     tells you nothing. */
  if (typeof value === "boolean") return value;
  return value.trim() !== "";
}

/** True when any field in the group is filled in, so it must not be hidden. */
export const anyFilled = (values: readonly FieldValue[]): boolean => values.some(filled);
