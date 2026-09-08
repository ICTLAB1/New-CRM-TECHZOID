import { useCallback, useEffect, useState } from "react";
import {
  myCompanies, readActiveCompany, resolveActiveCompany, roleIn, writeActiveCompany, type Company,
} from "./companies";
import { setActiveCompanyId } from "./store";

/**
 * The companies this person belongs to, and which one is on screen.
 *
 * IT RESOLVES BEFORE THE WORKSPACE LOADS, deliberately. Every query the
 * store makes is narrowed to the active company, so loading the workspace
 * first would fetch one company's records and then throw them away — or,
 * for somebody who belongs to two, briefly show both mixed together. The
 * app waits for `ready` before it asks for anything.
 *
 * A WORKSPACE WITH NO COMPANIES IS A REAL STATE, not an error: a person
 * whose account exists but who has not been added to a company yet. It
 * resolves with an empty list and no active company, and the store then asks
 * for the unscoped settings row, which is exactly how the CRM behaved before
 * companies existed.
 */
export interface CompaniesState {
  ready: boolean;
  companies: Company[];
  activeId: string | null;
  /** The role this person holds in the company ON SCREEN — not the one on
   *  their profile. A director of one business can be a salesperson in
   *  another. */
  role: string;
  error: string | null;
  switchTo: (id: string) => void;
  refresh: () => Promise<void>;
}

export function useCompanies(enabled: boolean): CompaniesState {
  const [ready, setReady] = useState(!enabled);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) { setReady(true); return; }
    try {
      const list = await myCompanies();
      const active = resolveActiveCompany(list, readActiveCompany());
      /* The store is told before anything is rendered with it, so the first
         query already carries the filter. */
      setActiveCompanyId(active);
      writeActiveCompany(active);
      setCompanies(list);
      setActiveId(active);
      setError(null);
    } catch (err) {
      /* A workspace that has not run migration 033 has no companies table.
         That is not a failure to report to somebody trying to do their job:
         it behaves exactly as it did before, with one unnamed company. */
      console.error("could not read the company list:", err);
      setActiveCompanyId(null);
      setCompanies([]);
      setActiveId(null);
      setError(null);
    } finally {
      setReady(true);
    }
  }, [enabled]);

  useEffect(() => { void load(); }, [load]);

  const switchTo = useCallback((id: string) => {
    setActiveCompanyId(id);
    writeActiveCompany(id);
    setActiveId(id);
  }, []);

  return {
    ready,
    companies,
    activeId,
    role: roleIn(companies, activeId),
    error,
    switchTo,
    refresh: load,
  };
}
