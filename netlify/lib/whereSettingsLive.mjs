/**
 * Where an admin actually changes a setting.
 *
 * This existed as ten separate string literals saying "in Netlify", left
 * behind when the CRM moved to Azure. None of them was wrong when written
 * and every one of them was wrong afterwards, so an admin told "add
 * INTERAKT_API_KEY in Netlify" went looking in a dashboard this app no
 * longer has. One copy, so the next move updates one line.
 *
 * Azure Functions sets WEBSITE_SITE_NAME itself, so the message names the
 * real app rather than one hardcoded here and then outlived.
 */
export function whereSettingsLive() {
  const app = String(process.env.WEBSITE_SITE_NAME ?? "").trim();
  return app
    ? `Azure → Function App ${app} → Environment variables, then Apply`
    : "Azure → your Function App → Environment variables, then Apply";
}

/** "Ask an admin to add FOO in Azure → …" */
export const askAdminToAdd = (names) =>
  `Ask an admin to add ${names} in ${whereSettingsLive()}.`;
