import { useState } from "react";
import { AppShell, PageHead } from "./AppShell";
import { ToastProvider } from "../components/Toast";
import { Card } from "../components/primitives";
import { CustomersScreen } from "../features/customers/CustomersScreen";
import { PipelineBoard } from "../features/pipeline/PipelineBoard";
import { CustomerSheet } from "../features/customers/CustomerSheet";
import { Showcase } from "./Showcase";
import { QuotationsScreen } from "../features/quotations/QuotationsScreen";
import {
  BRAND_LOGOS, CATALOG, CUSTOMERS, CUSTOM_FIELDS, PROFORMAS, QUOTATIONS, SETTINGS, USERS, WORKSPACE,
} from "./demoData";
import type { SalesDocument } from "../domain/documents/create";
import type { Customer } from "../domain/customers/customer";
import type { Workspace } from "../domain/customers/cascade";

/** The application. Screens land here as each stage completes; everything
 *  still to come falls through to a placeholder rather than a broken link. */
function Body() {
  const [view, setView] = useState("pipeline");
  const [customers, setCustomers] = useState<Customer[]>(CUSTOMERS);
  const [workspace, setWorkspace] = useState<Workspace>(WORKSPACE);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [quotations, setQuotations] = useState<SalesDocument[]>(QUOTATIONS);
  const [proformas, setProformas] = useState<SalesDocument[]>(PROFORMAS);
  const [settings, setSettings] = useState<Record<string, unknown>>(SETTINGS);
  const user = USERS[0]!;

  return (
    <AppShell view={view} onNavigate={setView} user={user}>
      {view === "customers" ? (
        <CustomersScreen
          customers={customers}
          workspace={workspace}
          users={USERS}
          customFields={CUSTOM_FIELDS}
          currentUser={user}
          onChange={(c, w) => { setCustomers(c); setWorkspace(w); }}
        />
      ) : view === "pipeline" ? (
        <main className="page">
          <PageHead
            title="Pipeline"
            sub="Drag a deal to move it. Moving to Lost asks why — you can always skip."
          />
          <PipelineBoard customers={customers} onChange={setCustomers} onOpen={setEditing} />
          {editing ? (
            <CustomerSheet
              customer={editing}
              users={USERS}
              customFields={CUSTOM_FIELDS}
              canReassign
              onSave={(next) => { setCustomers((cur) => cur.map((c) => (c.id === next.id ? next : c))); setEditing(null); }}
              onClose={() => setEditing(null)}
            />
          ) : null}
        </main>
      ) : view === "quotations" ? (
        <QuotationsScreen
          docType="quotation"
          documents={quotations}
          customers={customers}
          catalog={CATALOG}
          settings={settings}
          brandLogos={BRAND_LOGOS}
          currentUser={user}
          onChange={(docs, s) => { setQuotations(docs); setSettings(s); }}
          onCreateProforma={(pf) => { setProformas((cur) => [pf, ...cur]); setView("proformas"); }}
        />
      ) : view === "proformas" ? (
        <QuotationsScreen
          docType="proforma"
          documents={proformas}
          customers={customers}
          catalog={CATALOG}
          settings={settings}
          brandLogos={BRAND_LOGOS}
          currentUser={user}
          onChange={(docs, s) => { setProformas(docs); setSettings(s); }}
        />
      ) : view === "components" ? (
        <Showcase />
      ) : (
        <main className="page">
          <PageHead title="Not built yet" sub="This screen arrives in a later stage." />
          <Card>
            <p style={{ margin: 0 }}>
              Customers and the pipeline are working. Quotations, orders, dashboards, reports,
              integrations and settings are still to come.
            </p>
          </Card>
        </main>
      )}
    </AppShell>
  );
}

export function App() {
  return (
    <ToastProvider>
      <Body />
    </ToastProvider>
  );
}
