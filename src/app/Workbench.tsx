import { useState } from "react";
import { applyStage, type StageId } from "../domain/pipeline/stages";
import { AppShell, PageHead } from "./AppShell";
import { BroadcastPopup } from "../features/broadcasts/BroadcastPopup";
import { Card } from "../components/primitives";
import { CustomersScreen } from "../features/customers/CustomersScreen";
import { PipelineBoard } from "../features/pipeline/PipelineBoard";
import { CustomerSheet } from "../features/customers/CustomerSheet";
import { Presence } from "../components/Presence";
import { NotificationBell } from "../components/NotificationBell";
import type { CrmEvent } from "../domain/notifications/events";
import { Showcase } from "./Showcase";
import { QuotationsScreen } from "../features/quotations/QuotationsScreen";
import { OrdersScreen } from "../features/orders/OrdersScreen";
import { DispatchScreen } from "../features/orders/DispatchScreen";
import { RenewalsScreen } from "../features/subscriptions/RenewalsScreen";
import { ReceivablesScreen } from "../features/payments/ReceivablesScreen";
import { DashboardScreen } from "../features/dashboard/DashboardScreen";
import { ReportsScreen } from "../features/dashboard/ReportsScreen";
import { IntegrationsScreen } from "../features/settings/IntegrationsScreen";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { CatalogScreen } from "../features/catalog/CatalogScreen";
import { TeamScreen, type TeamMember } from "../features/team/TeamScreen";
import { IncentivesScreen } from "../features/incentives/IncentivesScreen";
import { ActivityScreen } from "../features/activity/ActivityScreen";
import { AssistantScreen } from "../features/assistant/AssistantScreen";
import { integrations } from "../integrations";
import { BRAND_LOGOS, DOC_IMAGES } from "./demoData";
import type { CatalogProduct } from "../domain/catalog/types";
import type { WorkspaceData } from "../data/useWorkspace";
import type { Customer } from "../domain/customers/customer";
import type { Workspace as OwnershipWorkspace } from "../domain/customers/cascade";
import { detectCustomerEvents } from "../domain/integrations/webhooks";

/**
 * Every screen, and the routing between them.
 *
 * It owns no data. Whatever holds the records — the demo fixtures or a live
 * Supabase workspace — passes them in and takes the changes back, so both
 * modes run exactly the same screens. Anything that behaves differently
 * between a preview and the real thing is a bug waiting for the worst
 * possible moment.
 */

export interface WorkbenchProps {
  data: WorkspaceData;
  settings: Record<string, unknown>;
  team: TeamMember[];
  /** `email` is what a quotation is sent as and replied to, and
   *  `designation` is what prints under the sender's name in that email —
   *  both already arrive here from the profile. */
  user: { id: string; name: string; email?: string; designation?: string; role: string };
  onChange: <K extends keyof WorkspaceData>(key: K, next: WorkspaceData[K]) => void;
  onSettingsChange: (next: Record<string, unknown>) => void;
  /** Settings the database changed by itself — a document counter the
   *  allocation RPC advanced. Adopted locally, never written back. */
  onSettingsNote?: (next: Record<string, unknown>) => void;
  onTeamChange: (next: TeamMember[]) => void;
  onRestore: (backup: Record<string, unknown>) => void;
  onSignOut?: () => void;
  /** Shown across the top when it is worth interrupting for. */
  banner?: React.ReactNode;
  /** What has changed in the workspace since this screen last looked. */
  events?: CrmEvent[];
  onEventsSeen?: () => void;
}

/** The lighter shape the reassignment cascade works on: who owns what. */
const ownershipOf = (data: WorkspaceData): OwnershipWorkspace => ({
  quotes: data.quotations.map((q) => ({ id: q.id, ownerId: q.ownerId, customerId: q.customerId })),
  proformas: data.proformas.map((p) => ({ id: p.id, ownerId: p.ownerId, customerId: p.customerId })),
  orders: data.orders.map((o) => ({ id: o.id, ownerId: o.ownerId, customerId: o.customerId })),
  challans: data.challans.map((c) => ({ id: c.id, ownerId: c.ownerId, orderId: c.orderId })),
  subscriptions: data.subscriptions.map((s) => ({ id: s.id, ownerId: s.ownerId, customerId: s.customerId })),
});

export function Workbench({
  data, settings, team, user, onChange, onSettingsChange, onSettingsNote, onTeamChange, onRestore, onSignOut, banner,
  events = [], onEventsSeen,
}: WorkbenchProps) {
  const [view, setView] = useState("dashboard");
  const [editing, setEditing] = useState<Customer | null>(null);

  const { customers, quotations, proformas, purchaseOrders, invoices, orders, challans, subscriptions } = data;
  const isAdmin = user.role === "Admin";
  const canEditSettings = isAdmin || user.role === "Manager";

  /* Both of these live in the settings row, exactly as they did in v1 —
     the catalog and the customer form's extra fields are configuration, not
     records, and the schema is not being changed to move them. */
  const catalog = (settings["productCatalog"] as CatalogProduct[] | undefined) ?? [];
  const customFields = (settings["customFields"] as { id: string; label: string }[] | undefined) ?? [];

  /** Reassigning a customer moves their documents too. The cascade returns
   *  the new ownership; this writes it back onto the full records, touching
   *  only the tables that actually changed. */
  const applyOwnership = (next: OwnershipWorkspace) => {
    const owners = (rows: { id: string; ownerId?: string }[]) =>
      new Map(rows.map((r) => [r.id, r.ownerId]));

    const move = <T extends { id: string; ownerId: string }>(
      key: keyof WorkspaceData,
      rows: T[],
      lookup: Map<string, string | undefined>,
    ) => {
      let changed = false;
      const updated = rows.map((row) => {
        const owner = lookup.get(row.id);
        if (!owner || owner === row.ownerId) return row;
        changed = true;
        return { ...row, ownerId: owner };
      });
      if (changed) onChange(key, updated as WorkspaceData[typeof key]);
    };

    move("quotations", quotations, owners(next.quotes));
    move("proformas", proformas, owners(next.proformas));
    move("orders", orders, owners(next.orders));
    move("challans", challans, owners(next.challans));
    move("subscriptions", subscriptions, owners(next.subscriptions));
  };

  /* One place a document can move a customer along the board. It only ever
     moves them forward — see src/domain/pipeline/advance.ts, which decides
     whether there is a move at all. */
  const advanceCustomer = (customerId: string, stage: string) => {
    handleCustomersChange(
      /* applyStage, not a bare field write: it is the one place that knows
         what else a stage carries — when a deal was won, what it was worth
         at the time, when it was last lost. */
      customers.map((c) => (c.id === customerId ? { ...applyStage(c, stage as StageId), updatedAt: Date.now() } : c)),
    );
  };

  /* Invoices are in here because the incentive calculation is measured on
     them. Leaving them out is why a raised, accepted invoice counted for
     nothing on that screen. */
  const analytics = { customers, quotations, proformas, invoices, orders, challans, subscriptions };

  /**
   * Every place a customer record is saved funnels through here — the
   * pipeline board drag, the customer sheet, and the customers list's inline
   * edits. Wrapping the one choke point catches deal-created, stage-changed
   * (including won/lost) and activity-logged for all three without any of
   * those screens needing to know webhooks exist.
   *
   * Dispatch is fire-and-forget: the real write happens either way, and a
   * webhook failing to send must never be why a salesperson's edit didn't
   * save. `sendWebhookEvent` decides server-side whether anything is even
   * configured — this always fires, cheaply, and the server no-ops when
   * webhooks are off.
   */
  const handleCustomersChange = (next: Customer[]) => {
    for (const { kind, payload } of detectCustomerEvents(customers, next)) {
      integrations.sendWebhookEvent(kind, payload).catch(() => {});
    }
    onChange("customers", next);
  };

  return (
    <AppShell
      view={view}
      onNavigate={setView}
      user={user}
      brand={settings["company"] as { name?: string; logo?: string } | undefined}
      onSignOut={onSignOut}
      banner={banner}
      bell={<NotificationBell events={events} onOpen={() => onEventsSeen?.()} />}
    >
      {/* At the shell, not on a screen: a message from an admin has to reach
          somebody wherever they happen to be looking. */}
      <BroadcastPopup names={new Map(team.map((m) => [m.id, m.name]))} />

      {view === "dashboard" ? (
        <DashboardScreen
          workspace={analytics}
          users={team}
          currentUser={user}
          settings={settings}
          onNavigate={setView}
        />
      ) : view === "reports" ? (
        <ReportsScreen workspace={analytics} users={team} currentUser={user} settings={settings} />
      ) : view === "customers" ? (
        <CustomersScreen
          customers={customers}
          workspace={ownershipOf(data)}
          users={team}
          customFields={customFields}
          currentUser={user}
          settings={settings}
          api={integrations}
          onChange={(next, ownership) => { handleCustomersChange(next); applyOwnership(ownership); }}
        />
      ) : view === "pipeline" ? (
        <main className="page">
          <PageHead
            title="Pipeline"
            sub="Drag a deal to move it. Moving to Lost asks why — you can always skip."
          />
          <PipelineBoard customers={customers} onChange={handleCustomersChange} onOpen={setEditing} />
          <Presence value={editing}>
            {(record, open) => (
            <CustomerSheet
              open={open}
              customer={record}
              users={team}
              customFields={customFields}
              canReassign={isAdmin || user.role === "Manager"}
              currentUser={user}
              settings={settings}
              onSave={(next) => {
                handleCustomersChange(customers.map((c) => (c.id === next.id ? next : c)));
                setEditing(null);
              }}
              onClose={() => setEditing(null)}
            />
            )}
          </Presence>
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
          onChange={(docs, s) => { onChange("quotations", docs); onSettingsChange(s); }}
          onSettingsNote={onSettingsNote}
          onCustomerStage={advanceCustomer}
          onCreateProforma={(pf) => { onChange("proformas", [pf, ...proformas]); setView("proformas"); }}
          onCreateInvoice={(inv) => { onChange("invoices", [inv, ...invoices]); setView("invoices"); }}
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
          onChange={(docs, s) => { onChange("proformas", docs); onSettingsChange(s); }}
          onSettingsNote={onSettingsNote}
          onCreateOrder={(order) => { onChange("orders", [order, ...orders]); setView("orders"); }}
          onCustomerStage={advanceCustomer}
          onCreateInvoice={(inv) => { onChange("invoices", [inv, ...invoices]); setView("invoices"); }}
        />
      ) : view === "invoices" ? (
        <QuotationsScreen
          docType="invoice"
          documents={invoices}
          customers={customers}
          catalog={catalog}
          settings={settings}
          brandLogos={BRAND_LOGOS}
          docImages={DOC_IMAGES}
          api={integrations}
          currentUser={user}
          onChange={(docs, s) => { onChange("invoices", docs); onSettingsChange(s); }}
          onSettingsNote={onSettingsNote}
        />
      ) : view === "receivables" ? (
        <ReceivablesScreen
          invoices={invoices}
          users={team}
          currentUser={user}
          settings={settings}
          onChange={(next) => onChange("invoices", next)}
        />
      ) : view === "purchase-orders" ? (
        <QuotationsScreen
          docType="purchase_order"
          documents={purchaseOrders}
          customers={customers}
          catalog={catalog}
          settings={settings}
          brandLogos={BRAND_LOGOS}
          docImages={DOC_IMAGES}
          api={integrations}
          currentUser={user}
          onChange={(docs, s) => { onChange("purchaseOrders", docs); onSettingsChange(s); }}
          onSettingsNote={onSettingsNote}
        />
      ) : view === "orders" ? (
        <OrdersScreen
          orders={orders}
          challans={challans}
          settings={settings}
          currentUser={user}
          onChange={(o, c, s) => { onChange("orders", o); onChange("challans", c); onSettingsChange(s); }}
          onSettingsNote={onSettingsNote}
        />
      ) : view === "dispatch" ? (
        <DispatchScreen challans={challans} onChange={(next) => onChange("challans", next)} />
      ) : view === "subscriptions" || view === "renewals" ? (
        <RenewalsScreen
          subscriptions={subscriptions}
          customers={customers}
          onChange={(next) => onChange("subscriptions", next)}
        />
      ) : view === "integrations" ? (
        <IntegrationsScreen api={integrations} user={user} users={team} settings={settings} onSettingsChange={onSettingsChange} />
      ) : view === "assistant" ? (
        <AssistantScreen api={integrations} workspace={analytics} users={team} currentUser={user} settings={settings} />
      ) : view === "activity" ? (
        <ActivityScreen workspace={analytics} users={team} currentUser={user} settings={settings} />
      ) : view === "catalog" ? (
        <CatalogScreen
          catalog={catalog}
          canEdit={canEditSettings}
          onChange={(next) => onSettingsChange({ ...settings, productCatalog: next })}
        />
      ) : view === "team" ? (
        <TeamScreen api={integrations} members={team} currentUser={user} onChange={onTeamChange} />
      ) : view === "incentives" ? (
        <IncentivesScreen workspace={analytics} settings={settings} users={team} currentUser={user} />
      ) : view === "settings" ? (
        <SettingsScreen
          settings={settings}
          canEdit={canEditSettings}
          onChange={onSettingsChange}
          api={integrations}
          workspaceForBackup={() => ({ ...analytics, settings })}
          onRestore={onRestore}
        />
      ) : view === "components" ? (
        <Showcase />
      ) : (
        <main className="page">
          <PageHead title="Nothing here" sub="That screen doesn't exist." />
          <Card>
            <p style={{ margin: 0 }}>Pick something from the sidebar.</p>
          </Card>
        </main>
      )}
    </AppShell>
  );
}
