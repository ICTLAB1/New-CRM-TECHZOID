# The email signature strip

The band of partner and certification badges that sits at the foot of every
email the CRM sends.

## email-signature.png

Microsoft Solutions Partner, Adobe Certified Reseller, Cisco Partner — the
artwork TechZoid was given by those companies. 1200x281, no transparency,
about 72 KB. Shown at 600px, so it stays sharp on a retina screen.

**It was flattened onto white before being committed.** The file supplied
had a fully transparent background, which looks right in a white email and
disappears in a dark-mode client, where those grey and black wordmarks sit
on near-black. Compositing it onto the white it was designed for makes it
safe everywhere, and changes nothing about how it looks.

## If you replace it

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
