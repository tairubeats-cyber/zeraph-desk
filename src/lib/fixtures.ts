/**
 * Stand-in data so the UI is real before the connectors are.
 * Replace with the 30 real inquiry emails you collect in Step 0 — the app is
 * only as good as the examples you tune the drafts against.
 */
import type { Action } from "./actions";
import type { Contact, Thread } from "./types";

const now = new Date();
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

export const FIXTURE_CONTACTS: Contact[] = [
  { id: "c1", name: "Dana Whitfield", email: "dana.w@example.com", phone: null, firstSeen: minutesAgo(45), lastSeen: minutesAgo(12), tags: [] },
  { id: "c2", name: "Marcus Hale", email: "m.hale@example.com", phone: null, firstSeen: minutesAgo(2880), lastSeen: minutesAgo(90), tags: ["past customer"] },
  { id: "c3", name: "Priya Raman", email: "priya@example.com", phone: null, firstSeen: minutesAgo(5), lastSeen: minutesAgo(5), tags: [] },
];

export const FIXTURE_THREADS: Thread[] = [
  { id: "t1", contactId: "c1", channel: "email", subject: "Quote for gutter replacement", intent: "new_inquiry", status: "open", lastMessageAt: minutesAgo(12) },
  { id: "t2", contactId: "c2", channel: "email", subject: "Following up on last spring's job", intent: "existing_customer", status: "open", lastMessageAt: minutesAgo(90) },
  { id: "t3", contactId: "c3", channel: "email", subject: "Do you service Westfield?", intent: "new_inquiry", status: "open", lastMessageAt: minutesAgo(5) },
];

export const FIXTURE_ACTIONS: Action[] = [
  {
    id: "a1",
    kind: "draft_reply",
    threadId: "t1",
    rationale: "New inquiry, 12 minutes old. Dana gave the house size but not the roofline, so the draft asks for that one detail and holds the price range.",
    payload: {
      kind: "draft_reply",
      to: "dana.w@example.com",
      subject: "Re: Quote for gutter replacement",
      inReplyTo: null,
      body: "Hi Dana,\n\nThanks for reaching out. For a 2,200 sq ft home, gutter replacement usually runs $1,400–$1,900 depending on the roofline and how many downspouts we end up running.\n\nOne question so I can tighten that up: is the second story a single run across the back, or does it wrap the side as well? A photo from the driveway is plenty.\n\nI can get someone out Thursday or Friday morning to measure.\n\n— Sam",
    },
    citations: [],
    status: "pending",
    createdAt: minutesAgo(11),
    decidedAt: null,
    declineReason: null,
  },
  {
    id: "a2",
    kind: "follow_up",
    threadId: "t2",
    rationale: "Marcus asked about a repair two days ago and hasn't answered the scheduling question. Worth one nudge before it goes cold.",
    payload: {
      kind: "follow_up",
      to: "m.hale@example.com",
      inReplyTo: null,
      body: "Hi Marcus — circling back on the downspout repair. Tuesday afternoon still works on our end if it works on yours.\n\n— Sam",
      sendAfter: new Date(now.getTime() + 86_400_000).toISOString(),
    },
    citations: [],
    status: "pending",
    createdAt: minutesAgo(88),
    decidedAt: null,
    declineReason: null,
  },
  {
    id: "a3",
    kind: "draft_reply",
    threadId: "t3",
    rationale: "Priya is asking about a town inside your service area. Straight yes, with the next step attached.",
    payload: {
      kind: "draft_reply",
      to: "priya@example.com",
      subject: "Re: Do you service Westfield?",
      inReplyTo: null,
      body: "Hi Priya,\n\nYes — Westfield is well inside our area, we're out there most weeks.\n\nWhat are you looking to have done? If you can send a photo or two I can usually give you a range same day.\n\n— Sam",
    },
    citations: [],
    status: "pending",
    createdAt: minutesAgo(4),
    decidedAt: null,
    declineReason: null,
  },
];
