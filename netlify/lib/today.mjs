/**
 * Today's date in the office's time zone (India), as yyyy-mm-dd.
 *
 * The server runs on UTC. Between midnight and 5:30 in the morning in India,
 * UTC is still on yesterday, so "what is due today" would come back a day
 * behind. The business runs on Indian dates; ask for those.
 */
export function officeToday(now = new Date(), timeZone = process.env.OFFICE_TIMEZONE || "Asia/Kolkata") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
