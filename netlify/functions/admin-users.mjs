import { fail, guard, json, readJson } from "../lib/http.mjs";
import { adminClient, isAdmin, signedInProfile } from "../lib/auth.mjs";
import { isEmail, str } from "../lib/validate.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";
import { asService } from "../../api/lib/db.mjs";

/**
 * Team accounts.
 *
 * Creating a sign-in, renaming one, resetting a password and removing a
 * member all need the service-role key, which must never reach a browser —
 * so they live here, behind a check that the caller really is an Admin.
 *
 * The role is read from `profiles` on the server. A request that says
 * "role: Admin" proves nothing; only the row in the database does.
 */

/** Roles an Admin may hand out. Anything else is rejected rather than
 *  silently stored, so a typo can't create a role no policy grants. */
const ASSIGNABLE_ROLES = ["Admin", "Manager", "Sales", "Accounts"];

/** What profiles.role is allowed to hold. Narrower than the list above by
 *  its own check constraint — see the note where it is applied. */
const PROFILE_ROLES = ["Admin", "Manager", "Sales"];

export async function handler(event) {
  const stop = guard(event);
  if (stop) return stop;

  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    return fail(event, 500, "Team management isn't configured on the server yet.", err?.message);
  }

  const caller = await signedInProfile(event);
  if (!caller) return fail(event, 403, "Sign in required.");
  if (!isAdmin(caller.role)) return fail(event, 403, "Only an Admin can manage team accounts.");

  const rl = await consume(admin, "admin-users", caller.user.id);
  if (!rl.allowed) return fail(event, 429, tooManyMessage(rl.retryAfterSeconds));

  const body = readJson(event);
  if (!body) return fail(event, 400, "That request wasn't valid JSON.");

  switch (body.action) {
    case "create_user": return createUser(event, admin, body, caller);
    case "update_user": return updateUser(event, admin, body);
    case "reset_password": return resetPassword(event);
    case "delete_user": return deleteUser(event, admin, body, caller.user.id);
    default: return fail(event, 400, "Unknown action.");
  }
}

/* ── ON AZURE ──────────────────────────────────────────────────────────
   Sign-in belongs to Microsoft Entra ID, so there is no password to set,
   reset or email out. A team member here is three rows: a local identity
   (auth.users), the profile the CRM shows, and a membership in a company.
   The first time they sign in with Microsoft, link_entra_identity joins
   their Entra account to the profile by email (supabase/042_entra_identity.sql).

   They still need a Microsoft account the CRM's directory accepts — staff
   on @techzoidtechnologies.com are invited as guests in Azure → Users. The
   response says so, because an account that exists here but cannot sign in
   reads as broken. */

const ENTRA_NOTE =
  "They sign in with their Microsoft 365 account. If they are new to the company, " +
  "also add them in Azure portal → Microsoft Entra ID → Users → Invite external user.";

async function createUser(event, admin, body, caller) {
  const email = str(body.email, 320).toLowerCase();
  const name = str(body.name, 120) || email.split("@")[0];
  const role = str(body.role, 20) || "Sales";
  const designation = str(body.designation, 120);
  const phone = str(body.phone, 40);
  /* Which company this person is being hired into. Sent by the browser,
     which knows what is on screen; verified below, because the service
     connection bypasses row-level security and would otherwise put
     somebody into a company the caller has nothing to do with. */
  const companyId = str(body.companyId, 64);

  if (!email) return fail(event, 400, "An email address is required.");
  if (!isEmail(email)) return fail(event, 400, `"${email}" doesn't look like an email address.`);
  if (!ASSIGNABLE_ROLES.includes(role)) {
    return fail(event, 400, `"${role}" isn't a role. Choose one of: ${ASSIGNABLE_ROLES.join(", ")}.`);
  }

  const company = await companyToJoin(admin, caller, companyId);
  if (company.error) return fail(event, 403, company.error);

  /* profiles.role allows Admin, Manager and Sales only; Accounts lives on
     the company membership. See the note in the original Supabase version. */
  const profileRole = PROFILE_ROLES.includes(role) ? role : "Sales";

  try {
    const userId = await asService(async (db) => {
      const dup = await db.query(
        "select 1 from public.profiles where lower(email) = $1 limit 1", [email]);
      if (dup.rowCount) {
        const e = new Error("dup"); e.code = "DUP"; throw e;
      }
      const u = await db.query(
        "insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('name', $2::text)) returning id",
        [email, name]);
      const id = u.rows[0].id;
      /* ON CONFLICT: a database that still has the Supabase trigger will
         already have made this row; either way it ends up as given here. */
      await db.query(
        `insert into public.profiles (id, name, email, role, designation, phone)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (id) do update set name = excluded.name, email = excluded.email,
           role = excluded.role, designation = excluded.designation, phone = excluded.phone`,
        [id, name, email, profileRole, designation, phone]);
      if (company.id) {
        await db.query(
          `insert into public.company_members (company_id, user_id, role) values ($1, $2, $3)
           on conflict (company_id, user_id) do nothing`,
          [company.id, id, role]);
      }
      return id;
    });
    return json(event, 200, {
      success: true, userId, joinedCompany: company.name || "",
      emailSent: false, emailError: null, note: ENTRA_NOTE,
    });
  } catch (err) {
    if (err?.code === "DUP") return fail(event, 400, `${email} is already on the team.`);
    return fail(event, 500, "That team member couldn't be added.", err?.message);
  }
}

async function updateUser(event, admin, body) {
  const userId = str(body.userId, 64);
  const name = str(body.name, 120);
  const email = str(body.email, 320).toLowerCase();
  /* Read with `in`, not truthiness: clearing a designation is a legitimate
     edit, and "" is exactly what that looks like arriving here. */
  const hasDesignation = Object.prototype.hasOwnProperty.call(body, "designation");
  const designation = str(body.designation, 120);
  const hasPhone = Object.prototype.hasOwnProperty.call(body, "phone");
  const phone = str(body.phone, 40);

  if (!userId) return fail(event, 400, "Which account? No user was given.");
  if (!name && !email && !hasDesignation && !hasPhone) return fail(event, 400, "Nothing to change.");
  if (email && !isEmail(email)) return fail(event, 400, `"${email}" doesn't look like an email address.`);

  const profilePatch = {};
  if (name) profilePatch.name = name;
  if (email) profilePatch.email = email;
  if (hasDesignation) profilePatch.designation = designation;
  if (hasPhone) profilePatch.phone = phone;
  const { error: profileErr } = await admin.from("profiles").update(profilePatch).eq("id", userId);
  if (profileErr) {
    return fail(event, 400, "That team record couldn't be updated. Reload and check the details.", profileErr.message);
  }

  /* A changed address is a different Microsoft account: unlink the old one
     so the new address links on its next sign-in, and keep the local
     identity row in step. */
  if (email) {
    try {
      await asService(async (db) => {
        await db.query("update public.profiles set entra_oid = null where id = $1", [userId]);
        await db.query("update auth.users set email = $2 where id = $1", [userId, email]);
      });
    } catch (err) {
      console.error("could not re-point the sign-in after an email change:", err?.message ?? err);
    }
  }
  return json(event, 200, { success: true });
}

async function resetPassword(event) {
  return fail(event, 400,
    "Passwords are managed by Microsoft now. Reset it in the Microsoft 365 admin centre, or the person can use 'Forgot password' on the Microsoft sign-in page.");
}

/**
 * Take someone off the team WITHOUT deleting their work.
 *
 * Deleting the profile cascades: subscriptions, purchase orders, invoices
 * and attachments are all `on delete cascade` from their owner. The
 * Supabase version deleted the account and took all of that with it. Here
 * the person loses access and their records stay, still showing their name.
 *
 * Access is cut three ways: no company memberships (nothing to see), no
 * linked Microsoft account, and the profile's email cleared so the next
 * Microsoft sign-in cannot link back to it. The address is kept on the
 * local identity row for the record.
 */
async function deleteUser(event, admin, body, callerId) {
  const userId = str(body.userId, 64);
  if (!userId) return fail(event, 400, "Which account? No user was given.");
  if (userId === callerId) return fail(event, 400, "You can't remove your own account.");

  const { data: target } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (target?.role === "Admin") {
    const { count, error } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "Admin");
    if (error) {
      return fail(event, 500, "Couldn't check how many Admins are left, so that account wasn't removed.", error.message);
    }
    if ((count ?? 0) <= 1) {
      return fail(event, 400, "That's the only Admin account. Make someone else an Admin first.");
    }
  }

  try {
    await asService(async (db) => {
      await db.query("delete from public.company_members where user_id = $1", [userId]);
      await db.query(
        "update public.profiles set entra_oid = null, email = '', role = 'Sales' where id = $1", [userId]);
    });
  } catch (err) {
    return fail(event, 500, "That account couldn't be removed.", err?.message);
  }
  return json(event, 200, {
    success: true,
    note: "Their quotations and records are kept. To stop them signing in to Microsoft entirely, remove them in Azure portal → Microsoft Entra ID → Users.",
  });
}


/**
 * The company a new sign-in should join, and whether the caller may.
 *
 * Falls back to the caller's own company when the browser did not say which
 * — an older deployment, or a workspace with one company — so a new person
 * always lands somewhere. Landing nowhere is the worst outcome: they can
 * sign in and every screen is empty, which reads as a broken account rather
 * than as missing membership.
 */
async function companyToJoin(admin, caller, requested) {
  const { data: mine } = await admin
    .from("company_members")
    .select("company_id, role, companies(name)")
    .eq("user_id", caller.user.id);

  const rows = mine ?? [];
  if (!rows.length) return { id: "", name: "" };

  const chosen = requested
    ? rows.find((r) => String(r.company_id) === requested)
    : rows[0];

  if (requested && !chosen) {
    return { error: "You can only add somebody to a company you belong to." };
  }
  if (!["Admin", "Manager"].includes(String(chosen?.role ?? ""))) {
    return { error: "Only an admin or manager of that company can add somebody to it." };
  }

  const company = Array.isArray(chosen.companies) ? chosen.companies[0] : chosen.companies;
  return { id: String(chosen.company_id), name: String(company?.name ?? "") };
}
