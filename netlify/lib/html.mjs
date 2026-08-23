/**
 * HTML for the OAuth callback, which answers a browser redirect rather than
 * a fetch and so must return a page.
 */

/**
 * Escape text for HTML.
 *
 * v1 interpolated Microsoft's `error_description` — a query-string value, so
 * attacker-controlled — and raw exception messages straight into this page.
 * A link of the form `...?error=x&error_description=<script>…` executed on
 * the CRM's own origin. Everything variable goes through here now.
 */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function resultPage(title, message, ok) {
  const colour = ok ? "#14664B" : "#96291A";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F4F5F7;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}
.c{background:#fff;border:1px solid #DFE3E8;border-radius:4px;padding:32px 36px;max-width:440px;text-align:center}
h1{font-size:17px;margin:0 0 10px;color:${colour}}
p{font-size:13px;color:#39424F;line-height:1.6;margin:0 0 20px}
a{display:inline-block;background:#1F4B99;color:#fff;text-decoration:none;padding:9px 18px;border-radius:3px;font-size:13px}
</style></head>
<body><div class="c"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>
<a href="/">Back to the CRM</a></div></body></html>`;
}

export const htmlHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  /* This page embeds no script and loads nothing. Say so. */
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  "Referrer-Policy": "no-referrer",
};
