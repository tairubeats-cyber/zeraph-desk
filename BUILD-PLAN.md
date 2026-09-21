# Build plan — v1, cut to the bone

One trade. One channel. One action. Five customers. Everything else waits.

## What v1 is

A home-services owner's new email inquiries appear with a reply already
written, using their real prices. They read it, edit it, send it. Nothing goes
out without their click.

When that sentence is true for five paying businesses, v1 is done.

## What got cut, and what replaces it

| Cut | Instead | Why |
| --- | --- | --- |
| Gmail OAuth | IMAP + SMTP with an app password | OAuth verification for a send scope takes weeks. App passwords work today on Gmail, Outlook, and small hosts alike. Requires 2-Step Verification; a Workspace admin can disable them. |
| Embeddings, chunking, vector search | One business facts sheet, pasted whole into the prompt | A contractor's entire pricing knowledge is ~1,500 words. Retrieval earns its keep only when documents outgrow the context window. |
| Installers, code signing, notarization | You install it yourself during the paid setup | Apple and Windows certificates cost money and waiting. Not needed for five installs you attend. |
| Auto-update | You push updates at the weekly check-in | Five customers. Call them. |
| Accounts, billing, admin panel | Stripe payment link, seat tokens issued by hand | Manual beats building at this size. |
| Quotes, scheduling, review requests | Reply only, plus one follow-up nudge | One thing done well is what gets renewed. |
| Three other trades | home_services only | The profiles stay in the code. Only one is switched on. |
| Dashboard, recipes | The event log keeps recording | Phase 3 and 4 read from it later. Don't stop writing to it. |

## Step 0 — Before code (this week)

- [ ] Write the business facts sheet for an imaginary roofing company yourself.
      If you can't fill it in, you don't yet know what to ask a real owner for.
- [ ] Find 10 real inquiry emails. Contractor Facebook groups, a BNI chapter
      visit, the chamber of commerce. Ask owners for the inquiry *and* the reply
      they sent. That pair is your quality bar.
- [ ] Decide your two numbers: setup fee and monthly. Say them out loud until
      you can say them without flinching.

## Step 1 — Environment (day 1)

- [ ] Node 20+, Rust via rustup, Tauri v2 prerequisites for your OS.
- [ ] `npm install && npm run tauri dev`. Window opens, queue renders fixtures.
- [ ] `git init`, commit, tag `scaffold`.

## Step 2 — Make the store real (week 1)

- [ ] Wire `tauri-plugin-sql`, run `migrations/001_init.sql` on startup.
- [ ] Replace the in-memory arrays in `src/lib/db.ts` with real queries.
- [ ] Load the 10 real emails as fixtures.
- [ ] Done when: approving an action survives a restart.

## Step 3 — The proxy (week 1, before any model call)

- [ ] Cloudflare Worker: holds the Anthropic key, checks a seat token, forwards
      to `/v1/messages`, logs tokens per seat, rate limits per seat.
- [ ] Point `VITE_ZERAPH_API` at it. Never ship the key in the binary.
- [ ] Done when: `generate()` returns text from the app.

## Step 4 — Business facts (week 2)

- [ ] Build the facts form (`src/views/Facts.tsx`). It's the setup appointment
      in software form.
- [ ] Save to the `settings` table, render into the prompt with
      `renderFacts()`.
- [ ] Done when: you can fill it in for a fake roofer in under 15 minutes.

## Step 5 — Email in, reply out (weeks 2–3)

- [ ] Rust side: IMAP fetch of unread messages, SMTP send. App password goes in
      the OS keychain via `keyring`, never in SQLite, never in the event log.
- [ ] Classify each new thread with `classify()`. Anything under 0.6 confidence
      goes to the owner as a question, not a guess.
- [ ] For `new_inquiry`, call `proposeReply()` and queue it.
- [ ] Approve sends over SMTP as a proper reply (In-Reply-To and References
      headers, or it starts a new thread in their customer's inbox).
- [ ] Done when: a test inquiry to a test mailbox comes back answered in under
      two minutes with your click.

## Step 6 — Tune against reality (week 4)

- [ ] Run all 10 real emails through. Put your draft next to what the owner
      actually sent. Fix the prompt, not the code.
- [ ] Watch for: inventing prices, asking two questions, sounding like software.
- [ ] Add the follow-up nudge at 48 hours of silence.
- [ ] Done when: you'd send 8 of 10 drafts unedited.

## Step 7 — Sell five (weeks 5–6)

- [ ] Pitch the number, not the technology: "Every lead gets answered in ten
      minutes, and you approve every word."
- [ ] Offer the first three a free month in exchange for blunt feedback and
      their sent folder.
- [ ] Install it yourself. Right-click-open on macOS, SmartScreen "more info" on
      Windows — fine when you're the one at the keyboard.
- [ ] Sit and watch one owner use it without helping. Write down every place
      they hesitate.

## Only after five are running

Code signing and notarization. Auto-update. Gmail OAuth (start the verification
paperwork now, in the background — it takes weeks and costs nothing to wait on).
The second trade. Then the dashboard, then recipes.
