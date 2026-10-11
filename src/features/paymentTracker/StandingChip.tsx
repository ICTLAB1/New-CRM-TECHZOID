import { Chip } from "../../components/primitives";
import type { BillStanding } from "../../domain/paymentTracker/schedule";

export function StandingChip({ standing, days }: { standing: BillStanding; days: number }) {
  switch (standing) {
    case "critical": return <Chip tone="bad" solid>{days}d overdue</Chip>;
    case "overdue": return <Chip tone="bad">{days}d overdue</Chip>;
    case "due_today": return <Chip tone="warn" solid>Due today</Chip>;
    case "due_soon": return <Chip tone="warn">In {-days}d</Chip>;
    case "upcoming": return <Chip tone="neutral">In {-days}d</Chip>;
    case "paid": return <Chip tone="good">Paid</Chip>;
    default: return <Chip tone="neutral">Written off</Chip>;
  }
}
