# Brand files served to the outside world

Anything in here is published at `https://<the site>/brand/<file>` with no
sign-in. That is the point: a mail client fetching a signature image has no
session and never will.

## email-signature.png

The designed signature strip at the foot of every email the CRM sends —
the logo, the contact block, the partner badges and the certification marks.

**It is supplied by the company, never drawn here.** Microsoft's, Adobe's,
Autodesk's and Cisco's marks belong to them and are issued to partners as
artwork; a CRM that approximated one would be producing a forgery of a
trademark that happens to be bad. The same goes for the ISO, MSME, DPIIT and
GeM marks, which say something about the company that only the issuing body
can say.

What the picture claims is also written out in words, in
`src/domain/integrations/emailIdentity.ts` (`SIGNATURE_IMAGE_ALT`). That is
what a reader sees when their mail client blocks images, which in Outlook on
Windows is the default — so the two must keep saying the same thing. If the
strip changes, change the words with it.

Replacing it: drop a new `email-signature.png` here and deploy. Nothing
else needs to change, and nothing needs to be re-entered in Settings.

Keep it around 1200px wide (it renders at 600) and under ~200 KB: it is
fetched once per email opened, on connections that are not always good.
