import { useState } from "react";
import { Button, Field, Input, Select, Textarea } from "../../components/primitives";
import { NOTE_OUTCOMES, NOTE_TYPES, blankNote, noteIsEmpty, sortedNotes, type NoteDraft } from "../../domain/customers/notes";
import type { Customer } from "../../domain/customers/customer";

/**
 * Everything anybody has said about this customer, and the box to say the
 * next thing.
 *
 * WHY IT IS HERE AND NOT ON A SEPARATE SCREEN. Recording a call is
 * something you do while you are looking at the customer — usually while
 * also moving the next follow-up date, which is the field directly above
 * this. Making it a separate destination is how "I'll write it up later"
 * becomes a call nobody wrote up.
 *
 * NOTES ARE ADDED, NEVER EDITED. There is no pencil on an existing note by
 * design: what someone recorded on Tuesday is what they recorded, and a log
 * that can be rewritten afterwards cannot be relied on by the person
 * reading it on Friday. A correction is a new note.
 */
export interface NotesPanelProps {
  customer: Customer;
  currentUser?: { id: string; name: string };
  /** Called with the note to add. The sheet folds it into the record it is
   *  about to save, so a note and the field changes around it go together
   *  rather than as two separate writes. */
  onAdd: (draft: NoteDraft) => void;
}

export function NotesPanel({ customer, currentUser, onAdd }: NotesPanelProps) {
  const [draft, setDraft] = useState<NoteDraft>(blankNote());
  const set = <K extends keyof NoteDraft>(k: K) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  const notes = sortedNotes(customer);
  const empty = noteIsEmpty(draft);

  const add = () => {
    if (empty) return;
    onAdd(draft);
    setDraft({ ...blankNote(), type: draft.type });
  };

  return (
    <div className="stack">
      <div className="eyebrow">Activity</div>

      <div className="stack">
        <div className="grid grid-2">
          <Field label="What happened">
            <Select value={draft.type} onChange={set("type")}>
              {NOTE_TYPES.map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Outcome" hint="Optional. Type your own if none of these fit.">
            <Input
              list="note-outcomes"
              value={draft.outcome ?? ""}
              onChange={set("outcome")}
              placeholder="e.g. Needs pricing"
            />
            <datalist id="note-outcomes">
              {NOTE_OUTCOMES.map((o) => <option key={o} value={o} />)}
            </datalist>
          </Field>
        </div>

        <Field label="Notes">
          <Textarea
            rows={3}
            value={draft.text}
            onChange={set("text")}
            placeholder="Spoke to Rajesh — wants the revised pricing with the AMC split out."
          />
        </Field>

        <Field label="Next action" hint="Optional. What you have committed to doing.">
          <Input value={draft.nextAction ?? ""} onChange={set("nextAction")} placeholder="e.g. Send revised quotation" />
        </Field>

        <div className="row-tight">
          <Button size="sm" tone="primary" onClick={add} disabled={empty}>Add to activity</Button>
          <span className="field-hint">
            {empty
              ? "Write what happened — an outcome on its own tells the next person nothing."
              : `Saved with the customer, as ${currentUser?.name || "you"}. Notes cannot be edited afterwards.`}
          </span>
        </div>
      </div>

      {notes.length ? (
        <ol className="note-list">
          {notes.map((n) => (
            <li key={n.id} className="note">
              <div className="note-head">
                <strong>{n.type}</strong>
                <span className="field-hint">
                  {n.user}
                  {n.ts ? " · " + new Date(n.ts).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : ""}
                </span>
              </div>
              <p className="note-text">{n.text}</p>
              {n.outcome ? <div className="field-hint">Outcome — {n.outcome}</div> : null}
              {n.nextAction ? <div className="field-hint">Next — {n.nextAction}</div> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="field-hint">
          Nothing recorded yet. Calls, emails and meetings logged here show up on the Activity screen too.
        </p>
      )}
    </div>
  );
}
