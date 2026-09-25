# CLAUDE.md

Read this before writing any code in this repo.

## What this is

A desktop app (Windows + macOS) for owners of small local service businesses —
contractors, salons, detailers, small law and accounting offices. It watches the
places work arrives (email today, more later), drafts the reply, and waits for
the owner to approve it. It answers from the business's own documents, so the
drafts use their real prices and policies.

Product name placeholder: **Zeraph Desk**. Built by Zeraph LLC.

The user is not a developer. Every screen assumes someone who runs a business,
not someone who runs software.

## The one rule

**Nothing leaves the machine without a human click.** No auto-send, ever, in v1.
Every outbound action lands in the approval queue first. If a feature seems to
need auto-send, stop and ask — don't build it.

## Architecture: one spine, four phases

Everything is built on a fixed spine so later phases are additions, not rewrites.

```
connectors  ->  store (SQLite)  ->  actions  ->  approval queue  ->  connectors
                      |
                  event log  ->  (Phase 3 dashboard, Phase 4 recipes)
```

- **Store** (`src/lib/db.ts`) — SQLite on the user's machine. Single source of
  truth. Tables in `src-tauri/migrations/`.
- **Connectors** (`src/connectors/`) — adapters that pull items in and push
  approved actions out. Each one normalizes to the shapes in `src/lib/types.ts`
  and knows nothing about the UI.
- **Actions** (`src/lib/actions.ts`) — a closed vocabulary of things the app can
  do. Adding a feature means adding an action, not a new code path. Do not
  invent ad-hoc side effects outside this file.
- **Approval queue** — proposed actions with status `pending`. The heart of the
  UI.
- **Event log** (`src/lib/events.ts`) — append-only. Every inbound item and every
  action transition gets logged. It looks unused in Phase 1. It is not: Phase 3
  renders from it and Phase 4 triggers off it. Keep writing to it.

Phase 1 = email in, draft out. Phase 2 = document grounding. Phase 3 = dashboard
from the event log. Phase 4 = plain-English recipes over actions + events.
Do not start a later phase before the one before it works end to end.

## Boundaries

- The Claude API key never ships in the app. The client calls our own proxy
  (`VITE_ZERAPH_API`), which holds the key and meters usage per seat. See
  `src/lib/claude.ts`.
- Business documents stay on disk. Only the retrieved snippets needed for a
  draft are sent to the model. Say it this way to users — precisely, not vaguely.
- React renders; it does not hold business logic. Logic lives in `src/lib/`.
- No secrets, tokens, or customer data in the event log or in console output.

## Conventions

- TypeScript strict. No `any` in `src/lib/`.
- Database access only through `src/lib/db.ts`. No raw SQL in components.
- Every action gets an `id`, a `kind` from the union, and a `rationale` string
  the owner can read. If you can't write a plain-English rationale, the action
  is too vague.
- Copy: sentence case, active voice, name what happens. "Send reply", not
  "Submit". The button's verb matches the toast that follows it.

## Design language

Apple-inspired: calm, spacious, quiet. Tokens live in `src/index.css` and are
mapped in `tailwind.config.js`; components read tokens (`bg-surface`,
`text-ink-secondary`), never raw colours, so a dark theme is one more token
block and nothing else.

- **Surfaces, back to front:** window (`background`), sidebar, card (`surface`),
  inset fills (`surface-secondary`), floating (`surface-elevated`, toasts).
- **One accent** (system blue): the primary action (approve, connect, save),
  selection, and keyboard focus. Everything else is neutral. Colour is for
  meaning only — success, warning, danger. Don't add a second accent.
- **Type:** system stack (SF on Apple, Inter elsewhere). Hierarchy comes from
  size, weight and spacing, never past weight 600. Named sizes: `text-title`,
  `text-heading`, `text-body`, `text-label`, `text-meta`.
- **Shared primitives** are in `src/components/ui/` (`Button`, `TextField`,
  `TextAreaField`, `Card`). Use them; don't restyle a raw `<button>` or `<input>`.
- **Motion** is short (150–250ms) and never decorative. `prefers-reduced-motion`
  is honoured globally in CSS and in `FloatingPathsBackground`.
- **Accessibility is not optional:** every control has a real label, text meets
  4.5:1 on the surface it sits on, focus is always visible, and the sidebar
  collapses to a rail and then a bottom tab bar rather than shrinking.
- Icons are Lucide, thin (`strokeWidth` 1.5–1.75). Don't mix icon sets.

## Current state — v1, cut

Scope is deliberately small: home services only, email only, reply and follow-up
only. Grounding is the business facts sheet (`src/lib/facts.ts`), not embeddings.
Mail is IMAP + SMTP with an app password held in the OS keychain on the Rust
side; OAuth is a v2 job. No installers, signing, auto-update, or billing until
five customers are running.

`BUILD-PLAN.md` holds the cut list and the ordered tasks. Work top down. Before
adding anything that isn't on it, check whether it's on the cut list first —
most good ideas right now are v2 ideas.

## Finance area (ZeraphDesk expansion)

ZeraphDesk is growing a personal financial command center beside the email desk.
The desk keeps its own nav group and rules above; this section governs everything
under `src/lib/finance/`, `src/components/finance/` and the Overview, Transactions
and Accounts views. It is not a copy of any other finance product: own layout,
wording and structure.

- **Provider seam.** Everything reads a `FinancialSnapshot` from `activeProvider`
  (`providers.ts`). A real aggregator, CSV import or manual entry implements
  `FinancialDataProvider` and replaces that one line. No view knows the source.
- **Never fake a connection.** Today's provider is `sample`: invented, generated
  deterministically, and labelled "Sample data" on every finance screen and every
  account. Don't add a "Connect" button until a provider really exists, and don't
  claim bank-level security, certifications, regulation or advisor status.
- **Stored vs. provided.** SQLite holds only the user's own choices
  (`fin_categories`, `fin_tx_overrides`). Account and transaction data is never
  copied into it.
- **Money is integer cents** (`formatMoney` in `money.ts`). Liability balances are
  stored as positive amounts; `ACCOUNT_KINDS[kind].class` says which side they're on.
- **Categories are data, not code.** Refer to them by id. Kind is `income`,
  `expense` or `transfer`; transfers (card payments, investment contributions)
  count as neither income nor spending.
- **Say what kind of statement a number is** with `BasisTag`: fact (reported),
  calculation (arithmetic on facts), projection (assumptions), AI insight,
  scenario (hypothetical). Never blur them. Projections and scenarios must be
  labelled as estimates, never as outcomes.
- **Neutral language.** Surface information, don't shame or instruct: "$88 more
  than at this point last month", not "you overspent".
- **Comparing months:** compare the same stretch (through today's day of month),
  never a partial month against a full one.
- **Nothing here touches the network yet.** When Intelligence (AI over the user's
  data) is built it goes through the proxy like drafts do, and what's sent needs
  a decision first: the desk rule is "only what the answer needs".
- **Navigation is one file, `src/nav.ts`.** The sidebar, phone tab bar, section
  tabs, "All sections" page and the view switch in `App.tsx` all read it. The tree
  is Overview; Money (Accounts, Transactions, Cash Flow, Bills, Recurring); Planning
  (Budgets, Goals, Forecast, Scenarios); Wealth (Net Worth, Investments, Debt);
  Intelligence (Action Center, Ask ZeraphDesk, Activity); Desk (the email product);
  Settings (Profile, Connections, Security, Preferences). Unbuilt sections stay
  listed with `built: false` and open a plain "not built yet" page. Building one
  means flipping that flag, adding its case in `App.tsx`, and nothing else.
- **Order of work:** phase 1 done (shell, Overview, Accounts, Transactions).
  Then money management (budgets, bills, recurring, cash flow, goals), then
  intelligence (action center, activity, notifications, ask-your-data), then
  planning (forecast, scenarios, debt, net-worth history), then wealth, then
  real provider infrastructure. Don't fake a later phase inside an earlier one.

## Trades

One engine, four industries. Everything industry-specific lives in
`src/lib/trades.ts` as a `TradeProfile`; `src/lib/draft.ts` builds both prompts
from it. Adding an industry means adding a profile — never a second code path,
never an `if (trade === ...)` outside that file.

Ship order: home_services, then auto, then beauty_wellness, then
professional_office. The last two carry real risk (treatment claims, and
unauthorized practice of law/accounting), so their `neverDo` lists are load
bearing, not decoration. Don't soften them to make a draft read better.
