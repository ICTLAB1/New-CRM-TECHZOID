# The email signature strip

The band of partner and certification badges that sits at the foot of every
email the CRM sends.

## There is no artwork here yet

`src/domain/integrations/emailIdentity.ts` has `SIGNATURE_IMAGE_PATH = ""`,
which means **no image is put in the signature at all**. That is deliberate,
and it is the fix for a fault that reached customers: the constant named
`/brand/email-signature.png` while nothing had been put at that address, so
every signature carried a broken-image icon with its alt text spilling out
underneath as a paragraph.

A missing image is not a blank space. It is a broken picture in somebody's
inbox.

## To turn it on

1. Put the artwork here as `email-signature.png`.
   - PNG, 1200px wide (it is shown at 600px, so this is for retina screens).
   - Under about 200 KB. Every email carries it.
   - No transparency — Outlook composites it onto white.
2. Set `SIGNATURE_IMAGE_PATH = "/brand/email-signature.png"` in
   `src/domain/integrations/emailIdentity.ts`.
3. Run the tests. `emailIdentity.test.ts` refuses to let that constant name
   a file that is not in `public/`, so step 1 cannot be forgotten.

A company can also point at its own image without touching the code, by
setting `signatureImage` on the company settings row.

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
