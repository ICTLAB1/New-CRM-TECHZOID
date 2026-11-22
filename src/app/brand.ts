/**
 * The company's own logo, as the INTERFACE shows it.
 *
 * THE FULL LOCKUP, not the wordmark. public/brand/company-logo.png is the
 * mark on its own, cropped deliberately for the email header — which
 * prints "Connect, Communicate & Collaborate" as text underneath, so the
 * strapline would otherwise appear twice for anybody with pictures
 * switched on and once for everybody else. See public/brand/README.md.
 *
 * On screen there is no such second copy, so the app shows the lockup as
 * the company had it drawn, strapline and all — and nothing sets that
 * text beside it.
 *
 * A COMPANY THAT UPLOADS ITS OWN STILL WINS. settings.company.logo
 * overrides this everywhere it is used; this is what shows when that has
 * never been filled in, which is the state every new workspace starts in
 * and the state this one was in.
 *
 * The guard in brand.test.ts refuses to let this name a file that is not
 * in public/ — the same guard SIGNATURE_IMAGE_PATH has, and for the same
 * reason: the code once named a file before anybody had put it there,
 * and every email went out with a broken-image icon.
 */
export const COMPANY_LOCKUP_PATH = "/brand/company-lockup.png";

/**
 * Microsoft's four-square mark, for the "Sign in with Microsoft" button.
 *
 * CROPPED FROM THE ARTWORK MICROSOFT SUPPLIES, not drawn here. It is the
 * left half of public/brand/vendor-microsoft.png — the same file the
 * company profile email prints — with the "Microsoft" wordmark cut away,
 * because the button sets that word in its own label and would otherwise
 * say it twice. public/brand/README.md carries the standing rule: another
 * company's mark is reproduced from the file they supply and is never
 * generated, redrawn or approximated.
 *
 * IT KEEPS ITS WHITE GROUND, which is why the button puts it in a white
 * tile rather than straight onto the orange. The mark was drawn for white
 * and four flat colours on burnt orange is not a thing to improvise.
 */
export const MICROSOFT_MARK_PATH = "/brand/microsoft-mark.png";

/**
 * The photograph behind the sign-in panel.
 *
 * CUT FROM THE COMPANY'S OWN REFERENCE DESIGN — the glass elevation at
 * sunset on the left-hand panel of the second login concept. It is the
 * only part of those renders wide enough to take cleanly: the rest of
 * that panel has the headline and the feature tiles set over it.
 *
 * IT IS 320px WIDE AND IS SCALED UP, which is why `.signin-photo` carries
 * a blur and why `.signin-scrim` sits over it at 86% opacity on the left.
 * Softness under a heavy scrim reads as depth of field; the same picture
 * sharp and unscrimmed would read as a low-resolution JPEG. If a
 * full-size original ever arrives it drops in here under the same name
 * and the blur can come off.
 *
 * DECORATIVE, so it is rendered with an empty alt and aria-hidden. A
 * screen reader has nothing to gain from "stock photograph of a
 * building", and the panel's actual content is the words beside it.
 */
export const SIGNIN_BACKDROP_PATH = "/brand/signin-backdrop.jpg";
