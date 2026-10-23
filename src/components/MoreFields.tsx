import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { anyFilled, type FieldValue } from "../domain/forms/disclosure";

/**
 * The fields most people leave blank, folded away until they are wanted.
 *
 * WHY. Creating a customer meant answering twenty-six questions to record a
 * company name and a phone number. Nothing on the form was wrong — every
 * field prints somewhere or drives the tax engine — but a form that asks
 * everything at once asks nothing in particular, and the two fields that
 * matter at first contact were buried among the twenty-four that did not.
 *
 * WHAT IT IS NOT. It is not deletion. Nothing has been taken off any form:
 * a designation, a website, an alternate number are all still there, one
 * click away, and still save exactly as they did. Removing a field removes
 * what somebody typed into it on three hundred existing records.
 *
 * It opens itself when any field inside is holding a value — see the rule
 * in domain/forms/disclosure.ts. That is checked when this mounts, which is
 * the same assumption the sheets around it already make: they seed their own
 * draft state from the record once, so a different record is a new mount.
 */
export function MoreFields({ label, filled: values = [], children }: {
  /** Named as the thing being revealed: "more contact details" reads as
   *  "Show more contact details". */
  label: string;
  /** The values of the fields inside. Any one of them filled in and the
   *  group starts open, because a form must never hide an answer. */
  filled?: readonly FieldValue[];
  children: ReactNode;
}) {
  const holdsSomething = anyFilled(values);
  const [open, setOpen] = useState(holdsSomething);

  return (
    <div className={"more-fields" + (open ? " is-open" : "")}>
      <button
        type="button"
        className="more-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        <span>{open ? "Hide" : "Show"} {label}</span>
        {/* Said once, on the collapsed state, so somebody who has never
            opened it knows there is something in there rather than a toggle
            that does nothing. */}
        {!open && holdsSomething ? <span className="more-mark">filled in</span> : null}
      </button>
      {open ? <div className="more-body">{children}</div> : null}
    </div>
  );
}
