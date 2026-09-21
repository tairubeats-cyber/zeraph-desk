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

Defined in `src/index.css` as tokens. Navy chrome, warm paper canvas, gold used
for exactly one thing: the approve action. Cormorant Garamond appears only in
display moments (queue heading, empty states); everything else is the UI sans.
Don't spread the gold around. Don't add a second accent.

## Current state — v1, cut

Scope is deliberately small: home services only, email only, reply and follow-up
only. Grounding is the business facts sheet (`src/lib/facts.ts`), not embeddings.
Mail is IMAP + SMTP with an app password held in the OS keychain on the Rust
side; OAuth is a v2 job. No installers, signing, auto-update, or billing until
five customers are running.

`BUILD-PLAN.md` holds the cut list and the ordered tasks. Work top down. Before
adding anything that isn't on it, check whether it's on the cut list first —
most good ideas right now are v2 ideas.

## Trades

One engine, four industries. Everything industry-specific lives in
`src/lib/trades.ts` as a `TradeProfile`; `src/lib/draft.ts` builds both prompts
from it. Adding an industry means adding a profile — never a second code path,
never an `if (trade === ...)` outside that file.

Ship order: home_services, then auto, then beauty_wellness, then
professional_office. The last two carry real risk (treatment claims, and
unauthorized practice of law/accounting), so their `neverDo` lists are load
bearing, not decoration. Don't soften them to make a draft read better.
