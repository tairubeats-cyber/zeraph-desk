import {
  Activity,
  ArrowDownUp,
  Building2,
  CalendarDays,
  ChartLine,
  ChartPie,
  CreditCard,
  Ellipsis,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Lock,
  Plug,
  ReceiptText,
  Repeat,
  Scale,
  Send,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  User,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * The whole app's navigation, in one place. The sidebar, the phone tab bar,
 * the section tabs, the "All sections" page and the view switch in App.tsx all
 * read this, so adding a screen means adding one entry here and one case in
 * App.tsx. Sections that aren't built yet stay listed (`built: false`) and open
 * a plain "not built yet" page, so the plan stays visible and nothing pretends
 * to work.
 */

export type ViewKey =
  | "overview"
  | "accounts"
  | "transactions"
  | "cash-flow"
  | "bills"
  | "recurring"
  | "budgets"
  | "goals"
  | "forecast"
  | "scenarios"
  | "net-worth"
  | "investments"
  | "debt"
  | "action-center"
  | "ask"
  | "activity"
  | "queue"
  | "history"
  | "facts"
  | "profile"
  | "connections"
  | "security"
  | "preferences"
  | "more";

export interface NavItem {
  key: ViewKey;
  label: string;
  icon: LucideIcon;
  built: boolean;
  /** One plain sentence: what this section is for. Shown on its page until it exists. */
  about: string;
  /** Which build phase delivers it (see PHASES). */
  phase?: number;
}

export interface NavGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
  /** Reading-width pages (forms, lists) rather than the wide workspace. */
  narrow?: boolean;
}

export const PHASES: Record<number, string> = {
  1: "Foundation",
  2: "Money management",
  3: "Financial intelligence",
  4: "Planning",
  5: "Wealth",
  6: "Infrastructure",
};

export const OVERVIEW: NavItem = {
  key: "overview",
  label: "Overview",
  icon: LayoutDashboard,
  built: true,
  about: "Where your money is, where it's going, and what needs a look.",
  phase: 1,
};

export const MORE: NavItem = {
  key: "more",
  label: "All sections",
  icon: Ellipsis,
  built: true,
  about: "Every section of ZeraphDesk.",
};

export const GROUPS: NavGroup[] = [
  {
    key: "money",
    label: "Money",
    icon: Wallet,
    items: [
      { key: "accounts", label: "Accounts", icon: Wallet, built: true, phase: 1, about: "Every account you own or owe on, by kind." },
      { key: "transactions", label: "Transactions", icon: ReceiptText, built: true, phase: 1, about: "Search, sort and categorise what came in and went out." },
      { key: "cash-flow", label: "Cash Flow", icon: ArrowDownUp, built: true, phase: 2, about: "Income against spending over time, and the recurring payments that shape it." },
      { key: "bills", label: "Bills", icon: CalendarDays, built: true, phase: 2, about: "Upcoming bills on a calendar, with due dates, paid status and autopay." },
      { key: "recurring", label: "Recurring", icon: Repeat, built: true, phase: 2, about: "Subscriptions and repeating payments found in your transactions, with what each costs a year." },
    ],
  },
  {
    key: "planning",
    label: "Planning",
    icon: Target,
    items: [
      { key: "budgets", label: "Budgets", icon: ChartPie, built: true, phase: 2, about: "Monthly and category budgets: budget, actual, remaining and projected." },
      { key: "goals", label: "Goals", icon: Target, built: true, phase: 2, about: "Savings and payoff goals, with progress and the monthly amount each one needs." },
      { key: "forecast", label: "Forecast", icon: ChartLine, built: true, phase: 4, about: "A projection of your balance from known income, bills and payments. A projection, never a promise." },
      { key: "scenarios", label: "Scenarios", icon: SlidersHorizontal, built: true, phase: 4, about: "What-if planning: see how a change could move your cash flow, goals and net worth." },
    ],
  },
  {
    key: "wealth",
    label: "Wealth",
    icon: Scale,
    items: [
      { key: "net-worth", label: "Net Worth", icon: Scale, built: true, phase: 4, about: "Assets minus liabilities over time, from today out to all time." },
      { key: "investments", label: "Investments", icon: TrendingUp, built: true, phase: 5, about: "Portfolio value, holdings, allocation and performance." },
      { key: "debt", label: "Debt", icon: CreditCard, built: true, phase: 4, about: "Balances, rates and payments, with estimates of how extra payments change the payoff date." },
    ],
  },
  {
    key: "intelligence",
    label: "Intelligence",
    icon: Sparkles,
    narrow: true,
    items: [
      { key: "action-center", label: "Action Center", icon: ListChecks, built: true, phase: 3, about: "Things that deserve your attention, with the data behind each and the options you have." },
      { key: "ask", label: "Ask ZeraphDesk", icon: Sparkles, built: true, phase: 3, about: "Ask questions about your own numbers. Answers show the data they used." },
      { key: "activity", label: "Activity", icon: Activity, built: true, phase: 3, about: "A chronological feed of what changed in your finances." },
    ],
  },
  {
    key: "desk",
    label: "Desk",
    icon: Inbox,
    narrow: true,
    items: [
      { key: "queue", label: "Waiting on you", icon: Inbox, built: true, about: "Replies drafted for your approval." },
      { key: "history", label: "Sent", icon: Send, built: true, about: "Everything you've approved or skipped." },
      { key: "facts", label: "Your business", icon: Building2, built: true, about: "The details every draft uses." },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    icon: Settings2,
    narrow: true,
    items: [
      { key: "profile", label: "Profile", icon: User, built: false, about: "Your name and how ZeraphDesk addresses you." },
      { key: "connections", label: "Connections", icon: Plug, built: true, about: "The email account and service seat ZeraphDesk uses." },
      { key: "security", label: "Security", icon: Lock, built: true, about: "What stays on this computer, and what leaves it." },
      { key: "preferences", label: "Preferences", icon: SlidersHorizontal, built: true, about: "What ZeraphDesk watches, and which notifications you get." },
    ],
  },
];

const ALL: { item: NavItem; group: NavGroup | null }[] = [
  { item: OVERVIEW, group: null },
  { item: MORE, group: null },
  ...GROUPS.flatMap((group) => group.items.map((item) => ({ item, group }))),
];

export function findItem(key: ViewKey): { item: NavItem; group: NavGroup | null } {
  return ALL.find((e) => e.item.key === key) ?? { item: OVERVIEW, group: null };
}

/** Where tapping a group's tab lands: its first working section, else its first. */
export function landingFor(group: NavGroup): ViewKey {
  return (group.items.find((i) => i.built) ?? group.items[0]).key;
}

export function groupOf(key: ViewKey): NavGroup | null {
  return findItem(key).group;
}
