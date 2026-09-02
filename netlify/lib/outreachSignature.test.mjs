import { describe, expect, it } from "vitest";
import * as server from "./outreachSignature.mjs";
import { renderSignature as clientRender, signatureFrom as clientFrom }
  from "../../src/domain/outreach/signature";
import { inlineFormat, renderHtml, stripMarkers } from "./outreachRender.mjs";
import { buildValues, fill } from "./outreachAudience.mjs";
import { readFileSync } from "node:fs";

/**
 * The signature in the preview and the signature in the email must be the
 * same bytes.
 *
 * Two implementations again, for the same reason as the audience rules:
 * Netlify functions are .mjs and screens are TypeScript. A preview that does
 * not match what is sent is worse than no preview — somebody checks it, sees
 * it is right, and ships something else.
 */

const FULL = {
  name: "Abhinav Jain",
  designation: "Managing Director",
  email: "abhinav.jain@techzoidtechnologies.com",
  mobile: "+91 97114 92098",
  companyName: "TechZoid Technologies Private Limited",
  tagline: "Connect, Communicate & Collaborate",
  logo: "data:image/png;base64,iVBORw0KGgo=",
  logoW: 180,
  logoH: 48,
  indiaAddress: "407, 4th Floor, Pearl Business Park, Netaji Subhash Place, Pitampura, New Delhi, Delhi, 110034, India",
  uaeAddress: "C-1, 1F - SF2571, Free Zone C1 Building, Ajman, UAE",
  uaeMobile: "+971 58 939 7239",
  website: "www.techzoidtechnologies.com",
  credentials: "Enterprise Software Licensing | Microsoft | Adobe | Autodesk | VMware | Cloud | Cybersecurity",
  badges: [{ src: "data:image/png;base64,iVBORw0KGgo=", label: "Microsoft Solutions Partner", width: 110 }],
  disclaimer: "No employee or agent is authorized to conclude any binding agreement on behalf of the company by email without specific confirmation.",
};

const CASES = [
  ["everything filled in", FULL],
  ["no logo", { ...FULL, logo: "" }],
  ["no UAE office", { ...FULL, uaeAddress: "", uaeMobile: "" }],
  ["no badges", { ...FULL, badges: [] }],
  ["no disclaimer", { ...FULL, disclaimer: "" }],
  ["nothing but a name", { name: "Abhinav Jain" }],
  ["nothing at all", {}],
];

describe("the preview and the sent signature are identical", () => {
  for (const [label, input] of CASES) {
    it(label, () => {
      expect(server.renderSignature(input)).toBe(clientRender(input));
    });
  }

  it("reads the same fields out of settings", () => {
    const settings = {
      company: {
        name: "TechZoid Technologies Private Limited",
        tagline: "Connect, Communicate & Collaborate",
        address: "407, 4th Floor, Pearl Business Park",
        city: "New Delhi", state: "Delhi", pincode: "110034", country: "India",
        phone: "+91 97114 92098", website: "www.techzoidtechnologies.com",
        logo: "data:image/png;base64,iVBORw0KGgo=", logoW: 180,
      },
      uaeOffice: { address: "C-1, 1F - SF2571, Ajman", phone: "+971 58 939 7239" },
      emailSignature: { credentials: "Microsoft | Adobe", disclaimer: "No employee…", badges: [] },
    };
    const user = { name: "Abhinav Jain", email: "a@t.example", designation: "Managing Director" };
    expect(server.signatureFrom(settings, user)).toEqual(clientFrom(settings, user));
    expect(server.renderSignature(server.signatureFrom(settings, user)))
      .toBe(clientRender(clientFrom(settings, user)));
  });
});

describe("what the signature will and will not render", () => {
  /* A signature goes on every message this company sends. Asserted with the
     badges cleared, so what is being measured is the logo and not the badge
     image that would otherwise supply an <img> of its own. */
  const noBadges = { ...FULL, badges: [] };

  it("drops a javascript: image source rather than rendering it", () => {
    const out = server.renderSignature({ ...noBadges, logo: "javascript:alert(1)" });
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<img");
  });

  it("drops a plain http image source", () => {
    expect(server.renderSignature({ ...noBadges, logo: "http://x.example/a.png" })).not.toContain("<img");
  });

  it("keeps an https one", () => {
    expect(server.renderSignature({ ...noBadges, logo: "https://x.example/a.png" })).toContain("<img");
  });

  it("drops a badge whose source is not one it will render", () => {
    const out = server.renderSignature({ ...FULL, logo: "", badges: [{ src: "javascript:alert(1)", label: "X" }] });
    expect(out).not.toContain("<img");
  });

  it("escapes a company name containing markup", () => {
    const out = server.renderSignature({ name: "A", companyName: '<script>alert(1)</script>' });
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;SCRIPT&gt;");
  });

  it("links a website written without a scheme", () => {
    expect(server.renderSignature({ name: "A", website: "www.techzoidtechnologies.com" }))
      .toContain('href="https://www.techzoidtechnologies.com"');
  });

  it("renders nothing at all when there is nothing to say", () => {
    expect(server.renderSignature({})).toBe("");
  });

  /* Emoji flags render as a pair of letters in Outlook on Windows, which
     reads as a typo in a signature. */
  it("labels the offices in words rather than flags", () => {
    const out = server.renderSignature(FULL);
    expect(out).toContain("INDIA");
    expect(out).toContain("UAE");
    expect(out).not.toMatch(/\p{Regional_Indicator}/u);
  });

  /* Outlook drops inline-block, so the badges have to be table cells. */
  it("lays the badges out as a table", () => {
    expect(server.renderSignature(FULL)).toContain("<td style=\"padding:6px 10px 0 0;vertical-align:middle;\">");
  });
});

/* ── the body's own formatting ─────────────────────────────────────── */

describe("the formatting a writer gets in the body", () => {
  it("makes a line bold", () => {
    expect(inlineFormat("**The reason I'm writing**")).toContain("<strong>The reason I&#039;m writing</strong>".replace("&#039;", "'"));
  });

  /* The one question worth answering, in yellow — the shape of the email
     this was built to reproduce. */
  it("highlights a question", () => {
    expect(inlineFormat("==What does your licensing look like?=="))
      .toContain('<mark style="background:#fff2a8;color:inherit;padding:1px 2px;">What does your licensing look like?</mark>');
  });

  it("italicises an aside", () => {
    expect(inlineFormat("So rather than pitch you anything, _I'd rather ask_:"))
      .toContain("<em>I'd rather ask</em>");
  });

  it("escapes before it formats, so markup in the text cannot get out", () => {
    const out = inlineFormat("<script>alert(1)</script> **bold**");
    expect(out).not.toContain("<script>");
    expect(out).toContain("<strong>bold</strong>");
  });

  it("links https only", () => {
    expect(inlineFormat("[site](https://x.example)")).toContain('href="https://x.example"');
    /* Left as the literal text somebody typed rather than turned into a
       link — which is the point, and is why this asserts on the href and not
       on the words. */
    const out = inlineFormat("[bad](javascript:alert(1))");
    expect(out).not.toContain("<a ");
    expect(out).not.toContain('href=');
  });

  /* A plain-text part reading "**The reason I'm writing:**" is what a mail
     merge looks like when nobody checked. */
  it("takes the markers back out for the plain-text part", () => {
    expect(stripMarkers("**Bold** and _italic_ and ==marked=="))
      .toBe("Bold and italic and marked");
  });

  it("turns a link into something readable in plain text", () => {
    expect(stripMarkers("[our site](https://x.example)")).toBe("our site (https://x.example)");
  });

  it("puts the signature between the message and the unsubscribe line", () => {
    const html = renderHtml({ body: "Hello.", unsubscribe: "https://x.example/u", signature: "<!--SIG-->" });
    expect(html.indexOf("Hello.")).toBeLessThan(html.indexOf("<!--SIG-->"));
    expect(html.indexOf("<!--SIG-->")).toBeLessThan(html.indexOf("unsubscribe"));
  });
});

/* ── who the sender is ─────────────────────────────────────────────── */

describe("the sender's own details reach the email", () => {
  const settings = { company: { name: "TechZoid Technologies Private Limited", phone: "+91 97114 92098" } };
  const caller = { profile: { name: "Abhinav Jain", email: "a@t.example", designation: "Managing Director" } };

  /* The bug: the server built the sender with company:"" and no designation,
     so a template using {{sender_company}} rendered literal braces in the
     email that went out while the composer's preview showed it filled. */
  it("fills the company name from settings, not the empty string", () => {
    const values = buildValues({}, {
      name: caller.profile.name,
      email: caller.profile.email,
      company: String(settings.company.name),
      designation: caller.profile.designation,
    });
    expect(values.sender_company).toBe("TechZoid Technologies Private Limited");
    expect(values.sender_name).toBe("Abhinav Jain");
    expect(values.sender_designation).toBe("Managing Director");
  });

  it("renders the intro line the templates actually use", () => {
    const values = buildValues({}, {
      name: "Abhinav Jain", email: "a@t.example",
      company: "TechZoid Technologies", designation: "Managing Director",
    });
    const out = fill(
      "I'm {{sender_name}}, {{sender_designation}} at {{sender_company}}.", values,
    );
    expect(out.text).toBe("I'm Abhinav Jain, Managing Director at TechZoid Technologies.");
    expect(out.missing).toEqual([]);
  });

  /* Both endpoints must build the sender the same way, or a test send and a
     launch fill the same template differently. */
  it("the launch and the test send read the sender from the same places", () => {
    const launch = readFileSync(new URL("../functions/outreach-launch.mjs", import.meta.url), "utf8");
    const test = readFileSync(new URL("../functions/outreach-test-send.mjs", import.meta.url), "utf8");
    for (const src of [launch, test]) {
      /* Read from settings, not invented; and the job title carried too. */
      expect(src).toMatch(/company:\s*String\(company\.name/);
      expect(src).toMatch(/designation:\s*caller\.profile\?\.designation/);
      /* The sender is built in one place in each file, and that place must
         not be the empty-string version the bug shipped. Checking the whole
         file would trip over a fake prospect row's own blank company. */
      const block = senderBlock(src);
      expect(block).not.toMatch(/company:\s*""/);
      expect(block).toMatch(/name:/);
      expect(block).toMatch(/email:/);
    }
  });
});

/** The object literal each endpoint builds its sender from — from the line
 *  that opens it to the closing brace. Used only by the test above, to keep
 *  the assertion off unrelated `company:` keys elsewhere in the file. */
function senderBlock(src) {
  const at = src.search(/(const sender = \{|senderOf = \(caller[^)]*\) => \{)/);
  expect(at).toBeGreaterThan(-1);
  const end = src.indexOf("\n};", at);
  return src.slice(at, end === -1 ? src.length : end);
}
