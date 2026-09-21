# Zeraph Desk

Desktop app for small local service businesses. New inquiries arrive with a
reply already written; the owner approves, edits, or skips. Nothing sends on its
own.

## Run it

```bash
npm install
npm run tauri dev
```

Requires Node 20+, Rust (rustup), and the Tauri v2 prerequisites for your OS.

## Where things are

| Path | What it holds |
| --- | --- |
| `CLAUDE.md` | Architecture contract. Read before changing anything. |
| `BUILD-PLAN.md` | Ordered task list. Work top down. |
| `src/lib/types.ts` | Core data shapes. |
| `src/lib/actions.ts` | The closed vocabulary of things the app can do. |
| `src/lib/db.ts` | The only place that touches the database. |
| `src/lib/trades.ts` | Per-industry config. Only `home_services` is on in v1. |
| `src/lib/facts.ts` | The business facts sheet — v1 grounding, no embeddings. |
| `src/lib/draft.ts` | Classification and the reply prompt. |
| `src/lib/events.ts` | Append-only log — the seed of the dashboard and recipes. |
| `src/connectors/` | Everything that talks to the outside world. |
| `src-tauri/migrations/` | Schema. |

Right now the mail connector is a stub and the queue renders fixtures, so the
interface is real before the plumbing is. `BUILD-PLAN.md` lists what's
deliberately cut from v1 and what replaces it.
