import { useState } from "react";
import { AppShell, PageHead } from "./AppShell";
import { ToastProvider } from "../components/Toast";
import { Card } from "../components/primitives";
import { CustomersScreen } from "../features/customers/CustomersScreen";
import { PipelineBoard } from "../features/pipeline/PipelineBoard";
import { CustomerSheet } from "../features/customers/CustomerSheet";
import { Showcase } from "./Showcase";
import { QuotationsScreen } from "../features/quotations/QuotationsScreen";
import { OrdersScreen } from "../features/orders/OrdersScreen";
import { DispatchScreen } from "../features/orders/DispatchScreen";
import { RenewalsScreen } from "../features/subscriptions/RenewalsScreen";
import { DashboardScreen } from "../features/dashboard/DashboardScreen";
import { ReportsScreen } from "../features/dashboard/ReportsScreen";
import { IntegrationsScreen } from "../features/settings/IntegrationsScreen";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { CatalogScreen } from "../features/catalog/CatalogScreen";
import { TeamScreen, type TeamMember } from "../features/team/TeamScreen";
import { IncentivesScreen } from "../features/incentives/IncentivesScreen";
import { ActivityScreen } from "../features/activity/ActivityScreen";
import type { CatalogProduct } from "../domain/catalog/types";
import { AssistantScreen } from "../features/assistant/AssistantScreen";
import { integrations } from "../integrations";
import type { SalesOrder, DeliveryChallan } from "../domain/orders/create";
import type { Subscription } from "../domain/subscriptions/expiry";
import {
  BRAND_LOGOS, CATALOG, CHALLANS, CUSTOMERS, DOC_IMAGES, ORDERS, PROFORMAS,
  QUOTATIONS, SETTINGS, SUBSCRIPTIONS, USERS, WORKSPACE,
} from "./demoData";
import type { SalesDocument } from "../domain/documents/create";
import type { Customer } from "../domain/customers/customer";
import type { Workspace } from "../domain/customers/cascade";

/** The application. Screens land here as each stage completes; everything
 *  still to come falls through to a placeholder rather than a broken link. */
function Body() {
  const [view, setView] = useState("dashboard");
  const [customers, setCustomers] = useState<Customer[]>(CUSTOMERS);
  const [workspace, setWorkspace] = useState<Workspace>(WORKSPACE);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [quotations, setQuotations] = useState<SalesDocument[]>(QUOTATIONS);
  const [proformas, setProformas] = useState<SalesDocument[]>(PROFORMAS);
  const [settings, setSettings] = useState<Record<string, unknown>>(SETTINGS);
  const [orders, setOrders] = useState<SalesOrder[]>(ORDERS);
  const [challans, setChallans] = useState<DeliveryChallan[]>(CHALLANS);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>(SUBSCRIPTIONS);
  const [catalog, setCatalog] = useState<CatalogProduct[]>(CATALOG);
  const [team, setTeam] = useState<TeamMember[]>(USERS);
  const user = team[0] ?? USERS[0]!;
  const isAdmin = user.role === "Admin";
  /* Defined in Settings → Custom fields, so both the customer form and the
     settings screen read one list. */
  const customFields = (settings["customFields"] as { id: string; label: string }[] | undefined) ?? [];

  return (
    <AppShell view={view} onNavigate={setView} user={user}>
      {view === "dashboard" ? (
        <DashboardScreen
          workspace={{ customers, quotations, proformas, orders, challans, subscriptions }}
          users={USERS}
          currentUser={user}
          settings={settings}
          onNavigate={setView}
        />
      ) : view === "reports" ? (
        <ReportsScreen
          workspace={{ customers, quotations, proformas, orders, challans, subscriptions }}
          users={USERS}
          currentUser={user}
          settings={settings}
        />
      ) : view === "customers" ? (
        <CustomersScreen
          customers={customers}
          workspace={workspace}
          users={USERS}
          customFields={customFields}
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
              customFields={customFields}
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
          catalog={catalog}
          settings={settings}
          brandLogos={BRAND_LOGOS}
          docImages={DOC_IMAGES}
          api={integrations}
          currentUser={user}
          onChange={(docs, s) => { setQuotations(docs); setSettings(s); }}
          onCreateProforma={(pf) => { setProformas((cur) => [pf, ...cur]); setView("proformas"); }}
        />
      ) : view === "proformas" ? (
        <QuotationsScreen
          docType="proforma"
          documents={proformas}
          customers={customers}
          catalog={catalog}
          settings={settings}
          brandLogos={BRAND_LOGOS}
          docImages={DOC_IMAGES}
          api={integrations}
          currentUser={user}
          onChange={(docs, s) => { setProformas(docs); setSettings(s); }}
        />
      ) : view === "orders" ? (
        <OrdersScreen
          orders={orders}
          challans={challans}
          settings={settings}
          onChange={(o, c, s) => { setOrders(o); setChallans(c); setSettings(s); }}
        />
      ) : view === "dispatch" ? (
        <DispatchScreen challans={challans} onChange={setChallans} />
      ) : view === "subscriptions" || view === "renewals" ? (
        <RenewalsScreen subscriptions={subscriptions} customers={customers} onChange={setSubscriptions} />
      ) : view === "integrations" ? (
        <IntegrationsScreen
          api={integrations}
          user={user}
          settings={settings}
          onSettingsChange={setSettings}
        />
      ) : view === "assistant" ? (
        <AssistantScreen
          api={integrations}
          workspace={{ customers, quotations, proformas, orders, challans, subscriptions }}
          users={USERS}
          currentUser={user}
          settings={settings}
        />
      ) : view === "activity" ? (
        <ActivityScreen
          workspace={{ customers, quotations, proformas, orders, challans, subscriptions }}
          users={team}
          currentUser={user}
          settings={settings}
        />
      ) : view === "catalog" ? (
        <CatalogScreen catalog={catalog} canEdit={isAdmin} onChange={setCatalog} />
      ) : view === "team" ? (
        <TeamScreen api={integrations} members={team} currentUser={user} onChange={setTeam} />
      ) : view === "incentives" ? (
        <IncentivesScreen
          workspace={{ customers, quotations, proformas, orders, challans, subscriptions }}
          settings={settings}
          users={team}
          currentUser={user}
        />
      ) : view === "settings" ? (
        <SettingsScreen
          settings={settings}
          canEdit={isAdmin}
          onChange={setSettings}
          workspaceForBackup={() => ({
            customers, quotations, proformas, orders, challans, subscriptions, catalog, settings,
          })}
          onRestore={(data) => {
            /* Whatever the file holds, one field at a time, each guarded —
               a backup written by an older version is missing some of them,
               and a missing list must leave what is here alone rather than
               emptying it. */
            const list = <T,>(key: string, current: T[]): T[] =>
              Array.isArray(data[key]) ? (data[key] as T[]) : current;
            setCustomers(list("customers", customers));
            setQuotations(list("quotations", quotations));
            setProformas(list("proformas", proformas));
            setOrders(list("orders", orders));
            setChallans(list("challans", challans));
            setSubscriptions(list("subscriptions", subscriptions));
            setCatalog(list("catalog", catalog));
            if (data["settings"] && typeof data["settings"] === "object") {
              setSettings((cur) => ({ ...cur, ...(data["settings"] as Record<string, unknown>) }));
            }
          }}
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
