import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { asService, closePool } from "./db.mjs";
import { forgetCatalog } from "./query.mjs";
import { handleBlob } from "./blob.mjs";

/**
 * Who may open, write and delete an attached file.
 *
 * The Azure SDK is stubbed; everything else is real — real tokens, real
 * database, real row-level-security policies. That split is deliberate: the
 * SDK call is four lines that either work or throw, while the questions
 * worth asking are whether one salesperson can open another's signed
 * contract, and whether anyone can write into somebody else's folder. Those
 * need the policies, not Azure.
 */
const HAVE_DB = !!(process.env.PGCONNECTION_STRING || process.env.DATABASE_URL);
const d = HAVE_DB ? describe : describe.skip;

const SECRET = "a-test-signing-secret-that-is-not-real";
const ASHA  = "a5a5a5a5-a5a5-a5a5-a5a5-a5a5a5a5a5a5";
const VIKAS = "b6b6b6b6-b6b6-b6b6-b6b6-b6b6b6b6b6b6";

const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
function tokenFor(userId) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${head}.${body}.${createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url")}`;
}

/** Records what it was asked to sign and delete, and invents a URL. */
function fakeBlobs({ failRemove = false } = {}) {
  const signed = [];
  const removed = [];
  return {
    signed, removed,
    client: {
      async sign(path, permissions, seconds) {
        signed.push({ path, permissions, seconds });
        return `https://acct.blob.core.windows.net/attachments/${path}?sig=fake`;
      },
      async remove(paths) {
        if (failRemove) throw new Error("storage is down");
        removed.push(...paths);
      },
    },
  };
}

const request = (body, { token = null, method = "POST", contentType = "application/json" } = {}) => {
  const headers = new Map();
  if (contentType) headers.set("content-type", contentType);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return {
    method,
    headers: { get: (n) => headers.get(String(n).toLowerCase()) ?? null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
};

const options = (blobs) => ({
  blobs,
  config: { alg: "HS256", secret: SECRET, issuer: null, audience: null, clockSkewSeconds: 60 },
  log: () => {},
});

const ASHA_PATH = `${ASHA}/quotation/q-1/abc123-contract.pdf`;

d("the attachment endpoint", () => {
  beforeAll(async () => {
    forgetCatalog();
    await asService(async (c) => {
      await c.query(`
        insert into auth.users (id, email, raw_user_meta_data) values
          ($1,'asha@techzoid.in','{"name":"Asha"}'),
          ($2,'vikas@techzoid.in','{"name":"Vikas"}')
        on conflict (id) do nothing`, [ASHA, VIKAS]);
      const company = (await c.query(
        `select id from public.companies order by created_at limit 1`)).rows[0].id;
      await c.query(`insert into public.company_members (company_id, user_id, role)
        values ($1,$2,'Sales'), ($1,$3,'Sales') on conflict do nothing`, [company, ASHA, VIKAS]);
      await c.query(`delete from public.attachments where path like '%-contract.pdf'`);
      await c.query(`
        insert into public.attachments
          (id, owner_id, uploaded_by_id, record_type, record_id, path, name, mime, size, uploaded_by, note, company_id)
        values ('att-1',$1,$1,'quotation','q-1',$2,'contract.pdf','application/pdf',1024,'Asha','',$3)`,
        [ASHA, ASHA_PATH, company]);
    });
  });

  afterAll(async () => {
    await asService(async (c) => {
      await c.query(`delete from public.attachments where path like '%-contract.pdf'`);
    });
    await closePool();
  });

  describe("opening a file", () => {
    it("signs a read for somebody the policies show the row to", async () => {
      const { client, signed } = fakeBlobs();
      const res = await handleBlob(
        request({ op: "read", path: ASHA_PATH }, { token: tokenFor(ASHA) }), options(client));

      expect(res.status).toBe(200);
      expect(res.jsonBody.url).toContain("sig=");
      expect(signed).toEqual([{ path: ASHA_PATH, permissions: "r", seconds: 300 }]);
    });

    /* -- THE ONE THAT MATTERS ------------------------------------------
       The whole point of not having a second permission model. Vikas has a
       perfectly valid token; the policies simply do not show him the row,
       so there is no link to give him. */
    it("refuses somebody the policies do not show it to", async () => {
      const { client, signed } = fakeBlobs();
      const res = await handleBlob(
        request({ op: "read", path: ASHA_PATH }, { token: tokenFor(VIKAS) }), options(client));

      expect(res.status).toBe(404);
      expect(signed).toEqual([]);
    });

    it("answers a file that does not exist exactly the same way", async () => {
      /* Otherwise this endpoint becomes a way to ask whether a given
         attachment path is real. */
      const { client } = fakeBlobs();
      const mine = await handleBlob(request(
        { op: "read", path: `${VIKAS}/quotation/q-9/zzz-contract.pdf` },
        { token: tokenFor(VIKAS) }), options(client));
      expect(mine.status).toBe(404);
    });

    it("refuses an unauthenticated caller outright", async () => {
      /* Unlike /api/q, where anonymous is a legitimate caller who sees
         nothing, there is no such thing as a public attachment. */
      const { client } = fakeBlobs();
      const res = await handleBlob(request({ op: "read", path: ASHA_PATH }), options(client));
      expect(res.status).toBe(401);
    });

    it("refuses a forged token", async () => {
      const { client } = fakeBlobs();
      const res = await handleBlob(
        request({ op: "read", path: ASHA_PATH }, { token: "not-a-token" }), options(client));
      expect(res.status).toBe(401);
    });
  });

  describe("uploading", () => {
    it("signs a create inside the caller's own folder", async () => {
      const { client, signed } = fakeBlobs();
      const path = `${VIKAS}/quotation/q-2/def456-new.pdf`;
      const res = await handleBlob(
        request({ op: "write", path }, { token: tokenFor(VIKAS) }), options(client));

      expect(res.status).toBe(200);
      /* "c", not "w": create-only, so an upload cannot overwrite bytes that
         are already there. */
      expect(signed[0].permissions).toBe("c");
    });

    /* -- ALSO THE ONE THAT MATTERS ------------------------------------
       There is no row yet, so the policies have nothing to judge. This is
       the rule Supabase's bucket policy enforced, and it is checked against
       the VERIFIED token rather than anything in the request. */
    it("refuses a write into somebody else's folder", async () => {
      const { client, signed } = fakeBlobs();
      const res = await handleBlob(
        request({ op: "write", path: `${ASHA}/quotation/q-1/xyz-sneaky.pdf` },
          { token: tokenFor(VIKAS) }), options(client));

      expect(res.status).toBe(403);
      expect(signed).toEqual([]);
    });

    it("refuses a path that climbs out of the container", async () => {
      const { client } = fakeBlobs();
      for (const path of [
        `${VIKAS}/../${ASHA}/quotation/q-1/abc-contract.pdf`,
        `/etc/passwd`,
        `${VIKAS}\\..\\x.pdf`,
        `${VIKAS}/q/'; drop table attachments; --.pdf`,
      ]) {
        const res = await handleBlob(
          request({ op: "write", path }, { token: tokenFor(VIKAS) }), options(client));
        expect([400, 403], path).toContain(res.status);
      }
    });
  });

  describe("deleting", () => {
    it("removes only the rows the policies allow, and their bytes with them", async () => {
      const { client, removed } = fakeBlobs();
      const mine = `${VIKAS}/quotation/q-3/ghi789-contract.pdf`;
      const company = await asService(async (c) => {
        const co = (await c.query(`select id from public.companies order by created_at limit 1`)).rows[0].id;
        await c.query(`insert into public.attachments
          (id, owner_id, uploaded_by_id, record_type, record_id, path, name, mime, size, uploaded_by, note, company_id)
          values ('att-2',$1,$1,'quotation','q-3',$2,'c.pdf','application/pdf',1,'Vikas','',$3)`,
          [VIKAS, mine, co]);
        return co;
      });
      void company;

      /* Asks for both his own and Asha's. The policies grant one. */
      const res = await handleBlob(request(
        { op: "delete", paths: [mine, ASHA_PATH] }, { token: tokenFor(VIKAS) }), options(client));

      expect(res.status).toBe(200);
      expect(res.jsonBody.removed).toEqual([mine]);
      expect(removed).toEqual([mine]);

      const ashasFileSurvives = await asService(async (c) =>
        (await c.query(`select count(*)::int as n from public.attachments where path = $1`, [ASHA_PATH])).rows[0].n);
      expect(ashasFileSurvives).toBe(1);
    });

    /* -- THE ORDERING ONE ----------------------------------------------
       Row first, then bytes, inside one transaction. If the store refuses,
       the throw rolls the transaction back and the row comes back with it.
       The Supabase version deleted the object first and could leave a row
       pointing at nothing. */
    it("puts the row back when the bytes cannot be removed", async () => {
      const { client } = fakeBlobs({ failRemove: true });
      const path = `${VIKAS}/quotation/q-4/jkl012-contract.pdf`;
      await asService(async (c) => {
        const co = (await c.query(`select id from public.companies order by created_at limit 1`)).rows[0].id;
        await c.query(`insert into public.attachments
          (id, owner_id, uploaded_by_id, record_type, record_id, path, name, mime, size, uploaded_by, note, company_id)
          values ('att-3',$1,$1,'quotation','q-4',$2,'c.pdf','application/pdf',1,'Vikas','',$3)`,
          [VIKAS, path, co]);
      });

      const res = await handleBlob(request(
        { op: "delete", paths: [path] }, { token: tokenFor(VIKAS) }), options(client));
      expect(res.status).toBe(500);

      const stillThere = await asService(async (c) =>
        (await c.query(`select count(*)::int as n from public.attachments where path = $1`, [path])).rows[0].n);
      expect(stillThere).toBe(1);
    });

    it("accepts an empty list without touching anything", async () => {
      const { client, removed } = fakeBlobs();
      const res = await handleBlob(
        request({ op: "delete", paths: [] }, { token: tokenFor(VIKAS) }), options(client));
      expect(res.status).toBe(200);
      expect(removed).toEqual([]);
    });
  });

  describe("the request itself", () => {
    it("refuses anything that is not a JSON POST", async () => {
      const { client } = fakeBlobs();
      const body = { op: "read", path: ASHA_PATH };
      expect((await handleBlob(request(body, { token: tokenFor(ASHA), method: "GET" }), options(client))).status).toBe(405);
      expect((await handleBlob(request(body, { token: tokenFor(ASHA), contentType: "text/plain" }), options(client))).status).toBe(415);
      expect((await handleBlob(request("nope", { token: tokenFor(ASHA) }), options(client))).status).toBe(400);
    });

    it("refuses an unknown operation", async () => {
      const { client } = fakeBlobs();
      const res = await handleBlob(
        request({ op: "list" }, { token: tokenFor(ASHA) }), options(client));
      expect(res.status).toBe(400);
    });

    it("says so when storage is not configured, rather than failing oddly", async () => {
      const res = await handleBlob(
        request({ op: "read", path: ASHA_PATH }, { token: tokenFor(ASHA) }),
        { ...options(null), blobs: null });
      expect(res.status).toBe(503);
    });
  });
});
