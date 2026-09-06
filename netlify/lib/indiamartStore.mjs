import { crmIdFor, customerFieldsFrom, noteFrom, queryId, queryTimeMs, queryTypeLabel } from "./indiamart.mjs";

/**
 * Writing an IndiaMART lead into the CRM.
 *
 * IDEMPOTENT BY CONSTRUCTION, because it has to be. The poller overlaps its
 * windows on purpose and the push webhook has no delivery guarantee, so the
 * same lead reaches this function several times as a matter of routine. The
 * row id is derived from IndiaMART's UNIQUE_QUERY_ID rather than generated,
 * which is what makes the second and third arrival an update of one row
 * instead of a second and third copy of the same buyer.
 *
 * IT NEVER OVERWRITES A PERSON'S WORK. Only the fields the lead actually
 * carried are merged, so a re-fetch cannot blank a phone number somebody
 * corrected by hand — and the stage is set only when the record is new, so
 * a lead a salesperson has already moved to Quoted does not get dragged
 * back to Lead every five minutes. That last one is the difference between
 * an integration people trust and one they turn off.
 */

/** Where a lead lands when nobody has said otherwise. */
const FIRST_STAGE = "lead";

export async function ownerFor(admin) {
  const { data: row } = await admin.from("settings").select("data").eq("id", "main").maybeSingle();
  const configured = ((row?.data ?? {}).indiamart ?? {}).ownerId;
  if (configured) return String(configured);

  /* Nothing chosen: fall back to an Admin. A record owned by nobody is
     invisible to the whole team under row-level security, which loses the
     lead just as thoroughly as never fetching it. */
  const { data: admins } = await admin
    .from("profiles").select("id").eq("role", "Admin").order("created_at").limit(1);
  return admins?.[0]?.id ?? null;
}

/**
 * Apply one lead. Returns what happened, so a run can report honestly.
 */
export async function applyLead(admin, lead, owner) {
  const qid = queryId(lead);
  if (!qid) return { status: "skipped", reason: "no UNIQUE_QUERY_ID" };

  const id = crmIdFor(qid);
  const { data: existing } = await admin
    .from("customers").select("id, owner_id, data").eq("id", id).maybeSingle();

  const ownerId = existing?.owner_id ?? owner;
  if (!ownerId) return { status: "skipped", reason: "no owner configured and no Admin to fall back to" };

  const current = existing?.data ?? {};
  const incoming = customerFieldsFrom(lead);
  const at = queryTimeMs(lead);

  /* The enquiry goes on the timeline. A buyer who asks twice should read as
     two enquiries, so notes are appended by id rather than replaced — and
     the id is theirs, so a re-fetch does not add the same note again. */
  const notes = Array.isArray(current.notes) ? current.notes.slice() : [];
  const note = noteFrom(lead);
  const already = notes.some((n) => n && n.id === note.id);
  if (!already) notes.push(note);

  const next = {
    ...current,
    ...incoming,
    id,
    ownerId,
    notes,
    source: current.source || "IndiaMART",
    /* Kept whole so the two systems can be reconciled by hand, and so a
       field this mapping does not recognise is visible rather than lost. */
    indiamartQueryId: qid,
    indiamartQueryType: String(lead.QUERY_TYPE ?? ""),
    indiamartPayload: lead,
    updatedAt: Date.now(),
  };

  if (!current.createdAt) next.createdAt = at;
  /* Set once, on creation only. See the note at the top. */
  if (!current.stage) next.stage = FIRST_STAGE;
  if (!next.currency) next.currency = "INR";
  if (!next.taxType) next.taxType = "gst";

  const { error } = await admin
    .from("customers")
    .upsert({ id, owner_id: ownerId, data: next }, { onConflict: "id" });

  if (error) return { status: "failed", reason: error.message, id };
  return {
    status: existing ? "updated" : "created",
    id,
    queryId: qid,
    newNote: !already,
    kind: queryTypeLabel(lead.QUERY_TYPE),
  };
}

/** Apply a batch, one at a time so a single bad lead cannot lose the rest. */
export async function applyLeads(admin, leads, owner) {
  const tally = { created: 0, updated: 0, skipped: 0, failed: 0 };
  const problems = [];
  for (const lead of leads) {
    const result = await applyLead(admin, lead, owner);
    tally[result.status] = (tally[result.status] ?? 0) + 1;
    if (result.status === "failed" || result.status === "skipped") {
      problems.push(`${result.queryId ?? "?"}: ${result.reason}`);
    }
  }
  return { ...tally, problems };
}

/* ── remembering where we got to ───────────────────────────────────── */

/** Read and write the integration's own corner of the settings row. */
export async function readState(admin) {
  const { data } = await admin.from("settings").select("data").eq("id", "main").maybeSingle();
  const all = data?.data ?? {};
  return { all, state: all.indiamart ?? {} };
}

export async function writeState(admin, all, patch) {
  const next = { ...all, indiamart: { ...(all.indiamart ?? {}), ...patch } };
  const { error } = await admin.from("settings").update({ data: next, updated_at: new Date().toISOString() }).eq("id", "main");
  if (error) console.error("indiamart: could not save state —", error.message);
}
