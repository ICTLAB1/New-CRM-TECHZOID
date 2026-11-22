# Brand artwork for emails

Everything in this folder is served over https from the CRM's own site and
referenced by absolute URL from the emails it sends. Nothing here is ever
embedded as a `data:` URI: Gmail strips those outright, which is how an
uploaded logo can look fine in Settings and arrive as an empty box.

## The email signature strip

The band of partner and certification badges that sits at the foot of every
email the CRM sends.

### email-signature.png

Microsoft Solutions Partner, Adobe Certified Reseller, Cisco Partner — the
artwork TechZoid was given by those companies. 1200x281, no transparency,
about 72 KB. Shown at 600px, so it stays sharp on a retina screen.

**It was flattened onto white before being committed.** The file supplied
had a fully transparent background, which looks right in a white email and
disappears in a dark-mode client, where those grey and black wordmarks sit
on near-black. Compositing it onto the white it was designed for makes it
safe everywhere, and changes nothing about how it looks.

### If you replace it

1. Put the new artwork here under the same name.
   - PNG, about 1200px wide.
   - Under about 200 KB. Every email carries it.
   - **No transparency.** Flatten onto white:
     `convert in.png -background white -alpha remove -alpha off -resize 1200x -strip out.png`
2. Nothing else to change.

## To turn it off

Set `signatureImage` to an empty string on the company settings row, or
`SIGNATURE_IMAGE_PATH = ""` in `src/domain/integrations/emailIdentity.ts`.
A company can also point at its own image there instead.

`emailIdentity.test.ts` refuses to let that constant name a file that is not
in `public/`. That guard exists because the opposite once shipped: the code
named this file before anybody had put it here, and every email went out
with a broken-image icon and its alt text spilling out underneath.

## The artwork is supplied, never drawn here

The strip carries other companies' trademarks — Microsoft, Adobe, Autodesk,
Zoho, HP, Dell, Lenovo, Cisco — and the marks of certification bodies. Those
are reproduced from the files those companies supply to their partners.

**Never generate, redraw or approximate them.** A redrawn partner badge is a
misrepresentation on every email the company sends, and a company that has
not been granted a partnership must not appear to claim one.

## The alt text

`SIGNATURE_IMAGE_ALT` is what a reader sees when their mail client blocks
images, which in Outlook is the default. It is short on purpose — "TechZoid
Technologies — partner and certification badges". It used to be the whole
list of partnerships and certifications, which read as a run-on sentence
under a broken image.

It also claims nothing specific, which is the right shape for text the CRM
generates rather than text a person wrote and checked.


## company-logo.png

The TechZoid wordmark, for the top of every email. 501x72, white ground,
about 21 KB. Drawn at 150px, so it is three times the size it is shown at
and stays sharp on a phone.

**The wordmark alone, not the full lockup.** The artwork as supplied has
"Connect, Communicate & Collaborate" set under the mark. The email header
already prints that strapline as text — and text is what a reader sees when
their client blocks pictures, which Outlook does by default. Printed whole,
the lockup would say it twice to everyone with pictures on and nobody with
them off. So the strapline was cropped away and the mark kept.

**Its alt text is empty on purpose.** The company's name is set in bold
directly beneath it, so an alt carrying the name printed it twice — once
wrapped over three lines inside the logo's own box, then again underneath.
An image whose content is already in the text next to it is decorative.

This is NOT `settings.company.logo`. That one is stored as a `data:` URI
for the PDF renderer, which embeds its own images, and must never be put in
an `<img src>` in an email.

## company-lockup.png

The full lockup — the wordmark, the pinwheel and "Connect, Communicate &
Collaborate" under it — as supplied. 640x131, white ground, about 12 KB.
Shown at about 220px in the rail, so it is three times its drawn size and
stays sharp.

**This one is for the SCREEN, company-logo.png is for the email.** They
are two crops of the same artwork and the difference is deliberate: the
email header prints the strapline as text underneath, so the lockup would
say it twice there. The interface prints no such text beside it, so it
shows the artwork whole. Do not point one at the other.

**It sits on a white panel in the navigation rail.** The rail is
near-black and the lockup is black artwork with a blue-and-amber mark, so
the rail gives it the ground it was drawn for. Inverting or recolouring it
to sit on the dark was the alternative and is not ours to do — a
recoloured mark is a company's identity redrawn by its own software.

**It is not `settings.company.logo`.** A company that uploads its own logo
overrides this everywhere; this is what shows when that has never been
filled in.

### If you replace it

1. Put the new artwork here under the same name.
   - PNG, about 640px wide, white ground, no transparency.
   - Under 60 KB — `src/app/brand.test.ts` fails above that, because this
     loads on first paint before anything else on the screen.
   - `convert in.png -fuzz 4% -trim +repage -background white -alpha remove
     -alpha off -resize 640x -strip -colors 64 out.png`
2. Nothing else to change. `.rail-logo` is height-led, so a mark of any
   proportion lands correctly without stretching.

`src/app/brand.test.ts` refuses to let `COMPANY_LOCKUP_PATH` name a file
that is not in `public/` — the same guard, and the same reason, as the
signature image above.

### The "TZ" monogram is not this company's mark

A set of design renders came in during the November 2026 redesign showing
a *different* lockup on the dark panels: a blue-and-orange **TZ**
monogram beside a white TECHZOID wordmark. Nothing here was changed to
match it, and it should not be reintroduced.

TechZoid has one logo — the wordmark with the pinwheel through the O and
"Connect, Communicate & Collaborate" under it — and that is what
`company-lockup.png` holds.

The app also used to draw its own: an orange tile reading "TZ" beside the
word TechZoid, in CSS, on the loading and session-error screens. That was
a letter mark this code invented. It is gone; those screens show the
lockup.

If a genuine reversed version of the real lockup is ever supplied, it
drops in beside this one and the white panel comes off
`.signin-aside-logo` and `.rail-brand`. Until then the white panel stays,
and nothing in this repository recolours the mark to produce one.

## microsoft-mark.png

Microsoft's four-square mark alone, for the "Sign in with Microsoft"
button on the front door. 96x96, white ground, about 3 KB.

**It is a crop of `vendor-microsoft.png`, not a drawing.** That file is
the mark and the word "Microsoft" together, as Microsoft supplies it: the
squares occupy the left 84px, the gap after them is white, and the
wordmark starts at 104px. Cropping in the gap takes the mark and nothing
else.

```
convert vendor-microsoft.png -crop 86x84+0+0 +repage -fuzz 4% -trim \
  +repage -resize 96x -strip microsoft-mark.png
```

**The wordmark is cut away on purpose.** The button sets "Sign in with
Microsoft" as its own label, so the whole file would print the word twice
— the same decision, for the same reason, as `company-logo.png` dropping
the strapline for the email header.

**It keeps its white ground, and the button gives it a white tile.** The
mark was drawn for white. Four flat colours straight onto burnt orange is
a recolouring of somebody else's mark, which is the thing this folder
exists to prevent.

The standing rule below applies to it in full: **never generate, redraw
or approximate it.** If Microsoft's artwork changes, replace
`vendor-microsoft.png` with the file they supply and re-run the crop.
`src/app/brand.test.ts` fails if `MICROSOFT_MARK_PATH` names a file that
is not here, and fails again if it is pointed back at the wordmark.

## vendor-microsoft.png, vendor-autodesk.png, vendor-adobe.png

The three vendors' own marks, for the "What we supply" block in the company
profile email. Each 84px tall, white ground, drawn at 100-104px wide.

**Supplied by the company that holds those relationships.** Nothing here is
drawn, traced or reconstructed. If one of these files is removed, the block
prints its words without a logo rather than a broken image — and
`src/domain/integrations/productLines.test.ts` fails if the code names a
file that is not here.

**Flattened onto white**, for the same reason the signature strip was: the
Microsoft and Adobe files came with transparent backgrounds, and the
Autodesk one on a light grey card, which was lifted to white so it does not
print as a grey patch on a white email.

## No ISO badge files

The three ISO certification marks were committed here and drawn at the foot
of the signature. They have been removed at the company's request: three
seals of different internal proportions under a 600px partner strip never
looked like part of the signature, and a certification is a claim that
reads better stated than drawn.

The signature now carries one line — "An ISO 9001:2015, ISO 27001 and
ISO/IEC 20000-1:2018 certified company" — built from CERTIFICATIONS in
`src/domain/integrations/emailIdentity.ts`. Text is searchable, selectable,
survives a client with pictures off, and needs no file kept in step with
anything.

The PDF still prints its own ISO marks from `src/assets/brandAssets.ts`.
That is unchanged.
