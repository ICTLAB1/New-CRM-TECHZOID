// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWorkspace } from "./useWorkspace";
import type { Store, WorkspaceData } from "./store";

/**
 * The promise made to somebody working with no signal: what they do is
 * kept, survives the app being closed, and uploads when the connection is
 * back — without overwriting it with the server's older copy first.
 */

const EMPTY: WorkspaceData = {
  customers: [], quotations: [], proformas: [], purchaseOrders: [], invoices: [],
  orders: [], challans: [], subscriptions: [],
};

function setOnline(v: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => v });
  window.dispatchEvent(new Event(v ? "online" : "offline"));
}

function fakeStore(server: { data: WorkspaceData; down: boolean }) {
  const uploads: unknown[] = [];
  const store: Store = {
    fetchEntity: vi.fn(), fetchSettings: vi.fn(), fetchProfiles: vi.fn(),
    async load() {
      if (server.down) throw new TypeError("Failed to fetch");
      return { data: server.data, settings: {}, profiles: [] };
    },
    async syncEntity(table: string, _prev: unknown, next: unknown) {
      if (server.down) throw new TypeError("Failed to fetch");
      uploads.push({ table, next });
      server.data = { ...server.data, customers: next as WorkspaceData["customers"] };
    },
    async syncSettings() { /* not used */ },
    subscribeAll: () => ({ unsubscribe: async () => {} }),
  } as unknown as Store;
  return { store, uploads };
}

beforeEach(() => setOnline(true));

describe("working offline", () => {
  it("keeps a change made offline and uploads it when the connection returns", async () => {
    const server = { data: { ...EMPTY, customers: [{ id: "c1", ownerId: "u", company: "Acme" }] } as WorkspaceData, down: false };
    const { store, uploads } = fakeStore(server);
    const { result } = renderHook(() => useWorkspace(true, "u", store));
    await waitFor(() => expect(result.current.state).toBe("ready"));

    server.down = true;
    act(() => setOnline(false));
    act(() => result.current.update("customers", [{ id: "c1", ownerId: "u", company: "Acme Renamed" }] as never));

    expect(result.current.data.customers[0]?.company).toBe("Acme Renamed");
    expect(result.current.pending).toBe(1);
    expect(uploads).toHaveLength(0);

    server.down = false;
    await act(async () => { setOnline(true); });
    await waitFor(() => expect(uploads).toHaveLength(1));
    await waitFor(() => expect(result.current.pending).toBe(0));
    expect(server.data.customers[0]?.company).toBe("Acme Renamed");
  });

  it("opens on the copy kept on the device when there is no connection", async () => {
    const server = { data: { ...EMPTY, customers: [{ id: "c9", ownerId: "u2", company: "Kept" }] } as WorkspaceData, down: false };
    const first = fakeStore(server);
    const a = renderHook(() => useWorkspace(true, "u2", first.store));
    await waitFor(() => expect(a.result.current.state).toBe("ready"));
    a.unmount();

    server.down = true;
    setOnline(false);
    const second = fakeStore(server).store;
    const b = renderHook(() => useWorkspace(true, "u2", second));
    await waitFor(() => expect(b.result.current.state).toBe("ready"));
    expect(b.result.current.offline).toBe(true);
    expect(b.result.current.data.customers[0]?.company).toBe("Kept");
  });

  it("a save that loses the connection halfway is queued, not thrown away", async () => {
    const server = { data: { ...EMPTY, customers: [{ id: "c1", ownerId: "u3", company: "A" }] } as WorkspaceData, down: false };
    const { store, uploads } = fakeStore(server);
    const { result } = renderHook(() => useWorkspace(true, "u3", store));
    await waitFor(() => expect(result.current.state).toBe("ready"));

    server.down = true; // the browser still thinks it is online
    act(() => result.current.update("customers", [{ id: "c1", ownerId: "u3", company: "B" }] as never));
    await waitFor(() => expect(result.current.pending).toBe(1));
    expect(result.current.data.customers[0]?.company).toBe("B");
    expect(result.current.saveError).toBeNull();

    server.down = false;
    await act(async () => { setOnline(true); });
    await waitFor(() => expect(uploads).toHaveLength(1));
  });
});
