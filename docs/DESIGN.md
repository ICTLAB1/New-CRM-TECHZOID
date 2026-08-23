# The interface

Light, professional, restrained. One accent blue. Colour is reserved for
meaning; structure is carried by hairline rules and a coloured left edge on
anything that needs action.

The rules below are enforced by `src/styles/design-rules.test.ts`, not by
memory — each is a decision a later change could quietly undo.

## Colour

| Token | Means | Used for |
|---|---|---|
| `--accent` | interactive, selected | primary button, active nav, links, focus |
| `--good` | won, paid, delivered | accepted quotes, settled proformas |
| `--warn` | needs attention | due soon, follow-up overdue, an import that found nothing |
| `--bad` | overdue, lost, failed | past validity, lost deals, errors |
| `--neutral` | no state | draft, inactive, expired |

Nothing else is coloured. A figure is near-black unless the number itself
carries a state — `₹18.60 L` of payments due is red because it is overdue,
not because it is money.

Tokens are named for meaning, never for hue: a token called `--green` invites
someone to use it because they want something green.

Every state chip carries a **dot as well as a hue**, because colour alone is
not a signal for everyone reading the screen.

## Type

Dense and quiet: small grey labels above larger near-black values. That
contrast is what makes a dense screen readable without drawing boxes
around everything.

- `.eyebrow` — mono, 10.5px, tracked out, uppercase. Column heads and section
  labels. The one piece of deliberate typographic character in the system.
- `.label` / `.value` — the core density device.
- **Tabular numerals everywhere.** Money that does not line up down a column
  reads as sloppy no matter what else is right. Set globally on `body` and
  again on every numeric surface.

## Structure over decoration

- **No gradients.** v1's primary button had one; decoration competes with the
  semantic colours that actually carry meaning.
- **One shadow** (`--lift`), for things genuinely floating: modals, sheets,
  toasts. Everything else is separated by a hairline.
- **The action edge** — a 3px coloured left rule on a card, table row or toast
  that needs something. It reads at a glance down a list, and it spends no
  colour on anything that is merely fine.
- No emoji, no "Live" badges.

## Controls

Destructive actions are stated in red text on a normal button, not as a red
fill — a red button is loud enough that people click it to make it go away.

Errors say what to do, not just what failed:

> Checksum failed — usually two digits transposed. Check it against the
> customer's certificate.

## Mobile

- Below 960px the sidebar becomes a drawer and the split editor stacks.
- **The document preview is hidden outright on a phone**, not scaled. A scaled
  A4 page is unreadable at that width and costs the form half the screen.
- Below 720px every modal becomes a **bottom sheet** — same component, same
  behaviours. A centred dialog on a phone fights the keyboard and puts its
  actions where the thumb is not. The sheet gets a grab handle and a sticky
  footer.
- Stat tiles never drop to one per row. Five KPIs at one per screen means five
  screens of scrolling before any content.

## Reviewing a change

Build it and look at it, at both widths:

```bash
npm run build && node scripts/shoot.mjs
# tmp/ui-desktop.png, tmp/ui-phone.png, tmp/ui-sheet.png
```

`src/app/Showcase.tsx` exercises every component on one screen so the system
can be reviewed as a whole rather than one control at a time.
