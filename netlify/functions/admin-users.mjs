import { fail, guard, json, readJson } from "../lib/http.mjs";
import { adminClient, isAdmin, signedInProfile } from "../lib/auth.mjs";
import { isEmail, str } from "../lib/validate.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";

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

const MIN_PASSWORD = 8;

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
    case "create_user": return createUser(event, admin, body);
    case "update_user": return updateUser(event, admin, body);
    case "reset_password": return resetPassword(event, admin, body);
    case "delete_user": return deleteUser(event, admin, body, caller.user.id);
    default: return fail(event, 400, "Unknown action.");
  }
}

async function createUser(event, admin, body) {
  const email = str(body.email, 320).toLowerCase();
  const password = String(body.password ?? "");
  const name = str(body.name, 120) || email.split("@")[0];
  const role = str(body.role, 20) || "Sales";
  const designation = str(body.designation, 120);
  const phone = str(body.phone, 40);

  if (!email || !password) return fail(event, 400, "An email address and a password are both required.");
  if (!isEmail(email)) return fail(event, 400, `"${email}" doesn't look like an email address.`);
  if (password.length < MIN_PASSWORD) {
    return fail(event, 400, `The password needs at least ${MIN_PASSWORD} characters.`);
  }
  if (!ASSIGNABLE_ROLES.includes(role)) {
    return fail(event, 400, `"${role}" isn't a role. Choose one of: ${ASSIGNABLE_ROLES.join(", ")}.`);
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error) {
    /* Supabase's own wording here is aimed at a person ("A user with this
       email address has already been registered") and is worth showing. */
    return fail(event, 400, str(error.message, 300) || "That account could not be created.");
  }

  const userId = data.user.id;

  /* A trigger creates the profile row as Sales. Set the name and the chosen
     role now. If this fails the sign-in exists but is mis-labelled, which is
     confusing rather than harmless — so say so instead of reporting success. */
  const { error: profileErr } = await admin.from("profiles").update({ name, role, designation, phone }).eq("id", userId);
  if (profileErr) {
    console.error("profile update after createUser failed:", profileErr.message);
    return json(event, 200, {
      success: true,
      userId,
      emailSent: false,
      warning: `The sign-in was created, but the name and role couldn't be saved. Set them from the team list — ${name} is currently a Sales user.`,
    });
  }

  const mail = await sendWelcome({ email, password, name });

  /* The account exists whether or not the email went out. Reporting failure
     here would tell an Admin to try again and hit "already registered", so
     the result is a success that states plainly what did and didn't happen. */
  return json(event, 200, { success: true, userId, emailSent: mail.sent, emailError: mail.error });
}

/**
 * Send the new member their sign-in details.
 *
 * Never throws: the caller has already created the account, and a mail
 * problem must not turn that into an error. Returns what actually happened.
 */
async function sendWelcome({ email, password, name }) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.EMAIL_FROM || "sales@techzoidtechnologies.com";
  const appUrl = process.env.APP_URL || "https://crm.ttpldelhi.com";

  if (!apiKey) {
    return { sent: false, error: "The account is ready, but no welcome email was sent — RESEND_API_KEY isn't configured in Netlify. Share the password directly." };
  }

  const text = [
    `Hi ${name},`,
    "",
    "An account has been created for you on the TechZoid Sales CRM.",
    "",
    `Sign in at: ${appUrl}`,
    `Email:    ${email}`,
    `Password: ${password}`,
    "",
    "Please sign in and change your password from Settings as soon as you can.",
    "",
    "TechZoid Technologies Private Limited",
  ].join("\n");

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        from: "TechZoid Technologies <" + fromAddress + ">",
        to: [email],
        subject: "Your TechZoid CRM account",
        text,
      }),
    });
    if (resp.ok) return { sent: true, error: null };
    const result = await resp.json().catch(() => ({}));
    /* Log the provider's reason; show the Admin only what to do about it. */
    console.error("welcome email refused:", resp.status, result?.name ?? result?.message);
    return { sent: false, error: "The account is ready, but the welcome email was refused by the email provider. Share the password directly." };
  } catch (err) {
    console.error("welcome email failed:", err?.message ?? err);
    return { sent: false, error: "The account is ready, but the welcome email couldn't be sent. Share the password directly." };
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

  /* The sign-in address lives on the auth record; the name lives in both the
     auth metadata and `profiles`. Update whichever was given, in that order,
     so the address someone signs in with and the name shown across the CRM
     never drift apart. */
  const authPatch = {};
  if (email) { authPatch.email = email; authPatch.email_confirm = true; }
  if (name) authPatch.user_metadata = { name };
  if (Object.keys(authPatch).length) {
    const { error } = await admin.auth.admin.updateUserById(userId, authPatch);
    if (error) return fail(event, 400, str(error.message, 300) || "That account could not be updated.");
  }

  const profilePatch = {};
  if (name) profilePatch.name = name;
  if (email) profilePatch.email = email;
  if (hasDesignation) profilePatch.designation = designation;
  if (hasPhone) profilePatch.phone = phone;
  const { error: profileErr } = await admin.from("profiles").update(profilePatch).eq("id", userId);
  if (profileErr) {
    return fail(event, 400, "The sign-in was updated, but the team record wasn't. Reload and check the details.", profileErr.message);
  }

  return json(event, 200, { success: true });
}

async function resetPassword(event, admin, body) {
  const userId = str(body.userId, 64);
  const newPassword = String(body.newPassword ?? "");

  if (!userId || !newPassword) return fail(event, 400, "An account and a new password are both required.");
  if (newPassword.length < MIN_PASSWORD) {
    return fail(event, 400, `The password needs at least ${MIN_PASSWORD} characters.`);
  }

  const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) return fail(event, 400, str(error.message, 300) || "That password could not be changed.");
  return json(event, 200, { success: true });
}

async function deleteUser(event, admin, body, callerId) {
  const userId = str(body.userId, 64);
  if (!userId) return fail(event, 400, "Which account? No user was given.");
  if (userId === callerId) return fail(event, 400, "You can't delete your own account.");

  /* Removing the last Admin locks everyone out of team management, settings
     and the admin-only functions — recoverable only from the Supabase
     dashboard. Refuse rather than let it happen. */
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

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return fail(event, 400, str(error.message, 300) || "That account could not be removed.");
  return json(event, 200, { success: true });
}
