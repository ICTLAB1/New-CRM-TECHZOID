import { useEffect, useState } from "react";
import { Button } from "./primitives";
import { recall, remember } from "../data/offline";
import {
  activeView, isDefaultView, readViews, removeView, saveView,
  type SavedView, type ViewDefaults,
} from "../domain/views/savedViews";

/**
 * The filter combinations one person keeps coming back to.
 *
 * A row of chips above a list: All, then whatever they saved, then a Save
 * offer that appears only when what they are looking at is not already one
 * of them. Offering Save on a view that is already saved is how a list ends
 * up with four copies of the same thing under four slightly different names.
 *
 * Stored per screen in this browser. Personal, not shared — see the note in
 * domain/views/savedViews.ts.
 */
export function SavedViews({ screen, current, defaults, onApply }: {
  /** Namespaces the storage: "quotations", "customers". */
  screen: string;
  /** The screen's filter state, exactly as it holds it. */
  current: Record<string, string>;
  /**
   * The value each filter holds when the screen opens, for the screens whose
   * resting state is not "all" — the payment tracker opens on pending bills.
   * Without it an untouched list reads as filtered and offers to save itself.
   */
  defaults?: ViewDefaults;
  onApply: (filters: Record<string, string>) => void;
}) {
  const key = `views:${screen}`;
  const [views, setViews] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => { setViews(readViews(recall(key))); }, [key]);

  const write = (next: SavedView[]) => {
    setViews(next);
    remember(key, next);
  };

  const active = activeView(views, current, defaults);
  const atDefault = isDefaultView(current, defaults);
  /* Save is offered only for something not already saved and not simply
     the unfiltered list, which needs no name. */
  const canSave = !active && !atDefault;

  const commit = () => {
    if (!name.trim()) return;
    write(saveView(views, name, current, defaults));
    setName("");
    setNaming(false);
  };

  return (
    <div className="saved-views">
      <button
        type="button"
        className="view-chip"
        aria-current={atDefault && !active}
        onClick={() => onApply({})}
      >
        All
      </button>

      {views.map((v) => (
        <span key={v.id} className="view-chip-wrap">
          <button
            type="button"
            className="view-chip"
            aria-current={active?.id === v.id}
            onClick={() => onApply(v.filters)}
          >
            {v.name}
          </button>
          <button
            type="button"
            className="view-chip-x"
            aria-label={`Remove the ${v.name} view`}
            onClick={() => write(removeView(views, v.id))}
          >
            ✕
          </button>
        </span>
      ))}

      {naming ? (
        <span className="row-tight">
          <input
            className="input view-name"
            autoFocus
            value={name}
            placeholder="Name this view"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") { setNaming(false); setName(""); }
            }}
          />
          <Button size="sm" tone="primary" onClick={commit} disabled={!name.trim()}>Save</Button>
          <Button size="sm" tone="quiet" onClick={() => { setNaming(false); setName(""); }}>Cancel</Button>
        </span>
      ) : canSave ? (
        <Button size="sm" tone="quiet" onClick={() => setNaming(true)}>Save this view</Button>
      ) : null}
    </div>
  );
}
