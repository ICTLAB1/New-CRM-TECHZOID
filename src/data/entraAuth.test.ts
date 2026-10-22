import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountInfo, IPublicClientApplication } from "@azure/msal-browser";
import { activeAccount } from "./entraAuth";

const THIS_TENANT = "7fbedec0-0c39-4028-b5af-5f73a3d65e64";
const OLD_TENANT = "1d063589-6565-42de-8055-92aca1128f35";

const account = (tenantId: string, username: string) =>
  ({ tenantId, username, localAccountId: username, homeAccountId: username } as unknown as AccountInfo);

/** Only the two methods activeAccount uses. */
const msalWith = (all: AccountInfo[], active: AccountInfo | null = null) =>
  ({ getAllAccounts: () => all, getActiveAccount: () => active } as unknown as IPublicClientApplication);

/* entraSettings reads import.meta.env in this same module, so the settings
   are supplied the way the app really gets them rather than mocked away. */
beforeEach(() => {
  vi.stubEnv("VITE_ENTRA_CLIENT_ID", "10c2125e-5080-4019-be51-108b85a3a3bf");
  vi.stubEnv("VITE_ENTRA_TENANT_ID", THIS_TENANT);
  vi.stubEnv("VITE_ENTRA_API_SCOPE", "api://10c2125e/.default");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("which Microsoft account the CRM signs in with", () => {
  it("refuses an account from the directory sign-in moved away from", () => {
    /* The bug: 047 moved sign-in to the company's own directory, and every
       browser that signed in before still caches the old guest account.
       Returning it produced a token the API rejects, which the CRM reported
       as "your account isn't set up yet" on a profile that was fine. */
    const stale = account(OLD_TENANT, "abhinav.jain@techzoidtechnologies.com");
    expect(activeAccount(msalWith([stale], stale))).toBeNull();
  });

  it("picks the one in this directory when both are cached", () => {
    const stale = account(OLD_TENANT, "abhinav.jain@techzoidtechnologies.com");
    const current = account(THIS_TENANT, "abhinav.jain@techzoidtechnologies.com");
    /* Active is the stale one — the choice must not follow it. */
    expect(activeAccount(msalWith([stale, current], stale))).toBe(current);
  });

  it("uses the active account when it is already the right one", () => {
    const current = account(THIS_TENANT, "chandan.s@techzoidtechnologies.com");
    expect(activeAccount(msalWith([current], current))).toBe(current);
  });

  it("is null when nothing is cached", () => {
    expect(activeAccount(msalWith([], null))).toBeNull();
  });
});
