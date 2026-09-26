# AGENTS.md

Instructions for AI coding tools (and people) working in this repo. **Read `CLAUDE.md` first.** It is the full rulebook; this file is the short list of what matters most.

## What this is

ZeraphDesk: a Tauri v2 desktop app (React, TypeScript, Tailwind, SQLite, Rust) for Windows and macOS. It began as an email-reply drafter for small businesses and now includes a personal finance area. The user is not a developer.

## Rules that must not break

1. **Nothing leaves the computer without a human click.** No auto-send, no background sync, no timers that call the network. Every outbound action is a button the person pressed.
2. **Never put secrets in the repo, logs, the event log or an export.** Email passwords and the SimpleFIN key live in the OS keychain (Rust side). The seat token is filtered from exports (`SECRET_SETTING_KEYS` in `src/lib/privacy.ts`). This repo is public.
3. **AI chat is the one place finances are sent anywhere** (`src/lib/finance/aiChat.ts`). Do not add anything to the summary that names a merchant, account, bank or transaction, and do not send anything the person hasn't reviewed on the review step. Ask before changing what is sent.
4. **Say what kind of statement a number is** (fact, calculation, projection, AI insight, scenario) and never blur them. Estimates are labelled estimates.
5. **Neutral wording, no advice.** "$88 more than last month", never "you overspent". Nothing claims to be financial advice, a bank-level security or a certification.
6. **Money is integer cents.** Use `formatMoney`. Liability balances are stored positive.
7. **Never fake a connection or real data.** Sample data is labelled as sample everywhere.

## How to work

- Logic goes in `src/lib/`, not in components. Database access only through `src/lib/db.ts`.
- Reuse `src/components/ui/` and the design tokens; don't restyle raw elements or add colours.
- **Every new calculation gets a test** in `tests/*.test.ts`. Run all of them with `npm test` and type-check with `npx tsc --noEmit`. Both must pass. Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml`.
- **A new database table** needs a migration in `src-tauri/migrations/`, registration in `src-tauri/src/main.rs`, and an entry in `TABLES` in `src/lib/privacy.ts`. A test fails if you skip the last one.
- **A new screen** is one entry in `src/nav.ts`, one case in `src/App.tsx`, and optionally a letter in `GO_KEYS` (`src/lib/shortcuts.ts`).
- A new outside service needs a row in the services table in `src/views/Security.tsx` that says what it can see and when.
- Match the surrounding code's style, comment density and naming.

## What not to do

- Don't bump versions, create tags or touch `.github/workflows/build-installers.yml`. Releases are the owner's job.
- Don't edit `src-tauri/tauri.conf.json`'s content security policy or add network hosts without asking.
- Don't run against or commit anyone's real financial data, and don't paste real credentials into tests. Use the sample data and the fixtures in `tests/fixtures/`.
- Keep pull requests small and about one thing. Say what you changed and how you checked it.
