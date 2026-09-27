import { createRoot } from "react-dom/client";
import "../src/styles/tokens.css";
import "../src/styles/base.css";
import "../src/styles/components.css";
import "../src/styles/shell.css";
import "./prototype.css";
import { Dashboard } from "./screens/Dashboard";
import { Leads } from "./screens/Leads";
import { LeadDetail } from "./screens/LeadDetail";
import { Accounts } from "./screens/Accounts";
import { Opportunity } from "./screens/Opportunity";
import { Pipeline } from "./screens/Pipeline";
import { Tasks } from "./screens/Tasks";
import { MyPerformance, Management } from "./screens/Team";
import { Reports } from "./screens/Reports";
import { Automations } from "./screens/Automations";
import { Login } from "./screens/Login";
import { Mobile } from "./screens/Mobile";

const SCREENS: Record<string, () => JSX.Element> = {
  login: Login, dashboard: Dashboard, leads: Leads, lead: LeadDetail,
  accounts: Accounts, opportunity: Opportunity, pipeline: Pipeline,
  tasks: Tasks, team: MyPerformance, management: Management,
  reports: Reports, automations: Automations, mobile: Mobile,
};

const which = new URLSearchParams(location.search).get("s") ?? "dashboard";
const Screen = SCREENS[which] ?? Dashboard;
createRoot(document.getElementById("root")!).render(<Screen />);
