/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

/** The module reads import.meta.env at call time, so it is re-imported. */
const load = async (base: string | undefined) => {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE", base ?? "");
  return import("./functions");
};

afterEach(() => vi.unstubAllEnvs());

describe("the address a function is reached at", () => {
  it("hangs off this site when the functions are served from it", async () => {
    /* What Azure Static Web Apps does: the functions answer under /api on
       the same site. */
    const { fnUrl, fnPath } = await load("/api");
    expect(fnPath("whatsapp-webhook")).toBe("/api/whatsapp-webhook");
    expect(fnUrl("whatsapp-webhook")).toBe(`${window.location.origin}/api/whatsapp-webhook`);
  });

  it("IS NOT GLUED TO THIS SITE'S ADDRESS when it is already a whole URL", async () => {
    /* The bug this exists to stop: the WhatsApp settings screen showed
       "http://localhost:5173http://localhost:7071/api/whatsapp-webhook"
       as the address to paste into Meta. */
    const { fnUrl } = await load("http://localhost:7071/api");
    const url = fnUrl("whatsapp-webhook");
    expect(url).toBe("http://localhost:7071/api/whatsapp-webhook");
    expect(url.indexOf("http")).toBe(url.lastIndexOf("http"));
  });

  it("does the same for an https base on another host", async () => {
    const { fnUrl } = await load("https://functions.example.com/api");
    expect(fnUrl("whatsapp-webhook")).toBe("https://functions.example.com/api/whatsapp-webhook");
  });
});
