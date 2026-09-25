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
- Never report something that didn't happen. A reply is only "sent" if the mail
  server accepted it. With no email account connected, or if sending fails, it
  stays in the queue with the owner's edits and the screen says why.

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
side; OAuth is a v2 job. Unsigned installers for Windows and Mac are built by
`.github/workflows/build-installers.yml` (see `INSTALL.md`); signing, auto-update and billing wait until
five customers are running.

`BUILD-PLAN.md` holds the cut list and the ordered tasks. Work top down. Before
adding anything that isn't on it, check whether it's on the cut list first —
most good ideas right now are v2 ideas.

**Example emails.** The three invented example emails a first run shows (`fixtures.ts`) are labelled "Example" and are deleted the moment a real email account is connected (`db.removeExamples`, called from `checkMail`), so an invented draft can never sit beside or be sent as a real one. Keep their ids in `EXAMPLE_*_IDS`.

## Finance area (ZeraphDesk expansion)

ZeraphDesk is growing a personal financial command center beside the email desk.
The desk keeps its own nav group and rules above; this section governs everything
under `src/lib/finance/`, `src/components/finance/` and the Overview, Transactions
and Accounts views. It is not a copy of any other finance product: own layout,
wording and structure.

- **Provider seam.** Everything reads a `FinancialSnapshot` from `activeProvider`
  (`providers.ts`). A real aggregator, CSV import or manual entry implements
  `FinancialDataProvider` and replaces that one line. No view knows the source.
- **Never fake a connection.** The default provider is `sample`: invented, generated
  deterministically, and labelled "Sample data" on every finance screen and every
  account. An account is only called "Connected" when a SimpleFIN access key is really
  saved and the last sync worked; imported files are "Imported", never a connection.
  Don't claim bank-level security, certifications, regulation or advisor status.
- **Stored vs. provided.** SQLite holds the user's own choices (`fin_categories`,
  `fin_tx_overrides`, and so on). The sample provider's accounts and transactions are
  never copied into it. The one exception is data the person imports themselves: it lives
  in `fin_src_*` and is read only by the imported provider.
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
- **The one finance network call is a SimpleFIN sync the person asked for** (below). When
  Intelligence (AI over the user's data) is built it goes through the proxy like drafts do,
  and what's sent needs a decision first: the desk rule is "only what the answer needs".
- **Navigation is one file, `src/nav.ts`.** The sidebar, phone tab bar, section
  tabs, "All sections" page and the view switch in `App.tsx` all read it. The tree
  is Overview; Money (Accounts, Transactions, Cash Flow, Bills, Recurring); Planning
  (Budgets, Goals, Forecast, Scenarios); Wealth (Net Worth, Investments, Debt);
  Intelligence (Action Center, Ask ZeraphDesk, Activity); Desk (the email product);
  Settings (Profile, Connections, Security, Preferences). Unbuilt sections stay
  listed with `built: false` and open a plain "not built yet" page. Building one
  means flipping that flag, adding its case in `App.tsx`, and nothing else.
- **Recurring payments are computed, not stored.** `recurring.ts` finds them in
  the transactions each time (three or more payments on a steady rhythm, steady
  or moderately varying amounts). Only the user's marks (`fin_recurring_marks`)
  and payments they add by hand are stored. Marking one cancelled changes how
  ZeraphDesk counts it and never claims to cancel anything with the merchant.
  Future dates are expectations from a pattern, labelled as projections.
- **Budgets and goals:** projected month-end spend is actual so far, plus
  recurring payments still expected, plus the daily pace of everything else
  (`budget.ts`). Goal progress is what the user records (start amount plus
  contributions); it is not read from an account until a provider exists.
- **The event log holds ids and kinds only.** Amounts, names and merchants stay
  out of it; a recurring payment is logged by a one-way fingerprint of its key.
- **Findings, notifications and Ask (phase 3).** `insights.ts` holds the detectors:
  pure functions over the same data the screens show. Each finding carries its
  numbers, why it might matter, and options that are choices, never commands.
  Only the person's response to a finding (dismissed, read, first seen) is stored
  (`fin_insights`); the finding itself is recomputed. Ids are stable per thing
  and period, so a dismissal holds for that month only. Notifications are just
  findings in a category the person left on. A detector switched off is not
  "resolved". Changes in balances, investments and debt can't be detected until
  balances have history.
- **Ask ZeraphDesk is deterministic code, not a model** (`ask.ts`). It answers
  from the data on this computer, shows what it was based on, and says "I can't"
  rather than guess (it can show which balances moved over a period, never why; with no balance history it says it can't).
  Nothing about a question or the data is sent anywhere. If a model is ever put in
  front of it to understand wording, it must call these same functions and add no
  numbers of its own; whether any data may be sent to one is a separate decision.
- **Planning (phase 4).** Nothing here is stored except what the person enters
  (`fin_debt_terms`, `fin_holdings` and their dated values, `fin_planned`,
  `fin_scenarios`); forecasts, payoff dates and scenario results are recomputed.
  - *Balance history comes from the provider* (`FinancialSnapshot.balanceHistory`); the
    sample invents one and says so. Don't rebuild it from transactions (they aren't
    complete per account) and don't record snapshots until a real provider exists.
    A gap in the data is filled by one rule (latest on or before, else the first
    known, else today's) and every fill is reported in `notes`.
  - *Net worth* counts accounts plus holdings the person added by hand (a home, a car,
    a family loan). Overview, Accounts, Ask and Net Worth all use `netWorthNow`, so
    the figure is the same everywhere.
  - *Debt rates and payments are entered, never guessed* and are labelled "you entered".
    Payoff dates are estimates (monthly compounding, nothing new charged).
  - *The forecast* follows checking and cash accounts only: recurring items that leave
    them, planned items, and an optional steady estimate of everyday spending. Anything
    charged to a credit card is left out because the card payment already carries it;
    counting both counts the money twice. It is a projection and says so.
  - *Scenarios report differences from carrying on*, never a predicted absolute, so they
    need no forecast of the baseline. Net worth in a scenario is cash + set aside + value
    of what was bought + reduction in debt, so the parts always sum to the total.
- **Wealth (phase 5).** Holdings (`Position`) and deposits (`InvestmentActivity`) come
  through the provider seam like everything else; the sample invents them, each account's
  holdings add up to its balance exactly, and the screen says so. Nothing is stored for
  investments except the long-term assumptions the person enters (`fin_long_term` in `settings`).
  - *No trading, no advice.* The workspace describes what's held and how it moved. Wording
    about allocation or concentration says what the split is and never whether it's right.
  - *Returns are Modified Dietz* (`investments.ts`): growth over the start value plus each
    deposit weighted by time invested. It's labelled an estimate and it never annualizes a
    stretch shorter than a year. Dividends are growth, never "money put in".
  - *Performance uses the same gap rule as net worth* (`balanceLookup` in `networth.ts`).
    Accounts with no holdings listed stay one "not broken down" slice; nothing is guessed.
  - *Long-term projection* (`longterm.ts`) uses only assumptions the person enters, shown as a
    range (assumed rate and 2 points either side), never one line, and says it is not a prediction.
  - *Investment findings:* `investments-drop` (down 10% or more over 30 days after counting
    deposits) and `concentration` (a single stock 15% or more; funds don't count). Both are
    off-limits for advice wording.
- **Real data without a bank connection (phase 6).** `pickProvider()` returns the imported
  provider once the person has added an account, otherwise the sample. Imported data is
  real (no sample notice) but it is not a bank connection and is never described as one;
  balances are what the person entered or the file's balance column said.
  - *Files are read on this computer* (`csv.ts`, an `<input type="file">`); nothing is uploaded.
    A row that can't be read is reported with its line number, never guessed at. Columns,
    date order and which sign means money out are detected, shown, and changeable; an
    ambiguous date order is asked, not assumed.
  - *Row ids are a hash of account, date, amount, description and the count of identical
    rows earlier in the file*, so re-importing adds nothing, an overlapping file adds only
    the new rows, and category corrections keep pointing at the same rows.
  - *Category guesses are derived, not stored.* Only a category the file itself named is
    stored; the keyword guess is computed when the data is read, so a better guesser fixes
    rows already imported. The transfer rule is deliberately strict: a line wrongly called a
    transfer vanishes from spending, which is worse than one left as "Other".
  - *Balance history for imported accounts* is the balance snapshots (`fin_src_balances`):
    what the person entered and the file's balance column. Same gap rule as everywhere.
  - *System notifications* (`notify.ts`, `osNotify.ts`) are off until the person turns them
    on, only for findings in categories they left on, once each (`os_notified`), rolled up
    past three. Turning them on doesn't announce what's already there. They show while the
    app is open; there is no background service. They carry the finding's title and summary.
  - *SimpleFIN Bridge* (`simplefin.rs`, `simplefin.ts`, `syncSimplefin.ts`) is the one aggregator. The person
    links their bank at the bridge and pastes the one-time setup token; Rust trades it for an
    access URL and keeps that in the OS keychain (same rule as the mail password: never returned to the
    webview, never in SQLite, never logged, never in an error message, and requests carry it in a
    header, not the URL). Only Rust talks to the bridge, so the webview's CSP stays closed to it.
    - *Sync is a click, never automatic.* No timer, no background job, nothing on launch.
      A sync makes up to 4 requests (45-day windows, about six months back the first time; later ones
      start 14 days before the last *complete* sync). The bridge allows about 24 a day, so ZeraphDesk stops
      at 20 in any 24 hours (`fin_sync_runs`).
    - *Pending lines are never stored.* Ids are a hash of the bridge's account and line ids, so a line
      syncs once however often it's fetched; a repeated id inside one account is told apart by order.
    - *The bridge doesn't say what an account is,* so the kind is a guess from its name that the person
      confirms before anything is saved; a debt read as an asset would corrupt net worth. Whether the bank
      shows debt as negative or positive is also chosen (`owed_positive`). Only US dollars: other currencies
      are listed but can't be added, because converting would be a guess.
    - *A partial sync* (older windows failed) keeps what arrived, is marked incomplete, and the next sync covers the
      gap again. Bridge messages are shown in the bridge's words and mark the connection "Needs attention".
    - *Balance history starts at the first sync* (a snapshot per sync); it isn't reconstructed.
    - *Not built:* automatic or background sync, Plaid, and the bridge's `holdings` (positions), so linked
      investment accounts still show a balance and nothing finer. Say "not built" rather than fake it.
    - *Security wording* (`Security` in Settings) must keep saying what leaves this computer: a read-only key and
      a date range go to the bridge, balances and transactions come straight back, and SimpleFIN knows which
      accounts were linked.
- **Seeding is idempotent.** Default rows go in with INSERT OR IGNORE behind a
  single shared promise, never "insert if the table is empty"; concurrent loads
  once left categories missing.
- **Order of work:** phases 1 to 5 done (shell, Overview, Accounts, Transactions; Recurring,
  Bills, Cash Flow, Budgets, Goals; Action Center, Activity, Ask, notifications,
  Preferences; Forecast, Scenarios, Debt, Net Worth; Investments with portfolio analysis
  and the long-term plan). Phase 6 is done except automatic sync: file import, SimpleFIN sync,
  balance snapshots and system notifications. Background or scheduled sync, and holdings from the bridge, are not built.
  Don't fake a later phase inside an earlier one.

## Trades

One engine, four industries. Everything industry-specific lives in
`src/lib/trades.ts` as a `TradeProfile`; `src/lib/draft.ts` builds both prompts
from it. Adding an industry means adding a profile — never a second code path,
never an `if (trade === ...)` outside that file.

Ship order: home_services, then auto, then beauty_wellness, then
professional_office. The last two carry real risk (treatment claims, and
unauthorized practice of law/accounting), so their `neverDo` lists are load
bearing, not decoration. Don't soften them to make a draft read better.
