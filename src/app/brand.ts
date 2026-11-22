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
