/**
 * The part that decides whether this product feels sharp or generic.
 *
 * Two calls per inbound message: classify (cheap, structured), then draft
 * (only for the ones worth drafting). Both are grounded in the trade profile
 * and, once Phase 2 lands, in the owner's own documents.
 */
import { generateJSON } from "./claude";
import type { TradeProfile } from "./trades";
import type { Action, ActionPayload } from "./actions";
import { type BusinessFacts, renderFacts } from "./facts";

/* ---------------------------------------------------------------- classify */

export interface Classification {
  intent: "new_inquiry" | "existing_customer" | "vendor" | "noise";
  /** 0–1. Below 0.6 the app asks the owner instead of guessing. */
  confidence: number;
  urgency: "now" | "today" | "whenever";
  /** Which intake fields the message already answers. */
  knows: string[];
  /** Which it doesn't. The draft asks about at most one of these. */
  missing: string[];
}

export function classifyPrompt(profile: TradeProfile): string {
  return `You sort incoming messages for a ${profile.label.toLowerCase()} business.

The information this business needs before it can help someone:
${profile.intakeFields.map((f) => `- ${f}`).join("\n")}

Classify the message. Be strict about "new_inquiry": it means someone who wants
work done and is not already a customer. Marketing, spam, and software vendors
are "noise" no matter how personally addressed they look.

Return only this JSON, no prose and no code fences:
{"intent":"new_inquiry|existing_customer|vendor|noise","confidence":0.0,"urgency":"now|today|whenever","knows":[],"missing":[]}`;
}

export async function classify(
  message: string,
  profile: TradeProfile,
  seatToken: string,
): Promise<Classification> {
  return generateJSON<Classification>(
    {
      system: classifyPrompt(profile),
      messages: [{ role: "user", content: message }],
      maxTokens: 300,
    },
    seatToken,
  );
}

/* ------------------------------------------------------------------ draft */

const PRICING_RULE: Record<TradeProfile["pricingModel"], string> = {
  range_then_visit:
    "Give an honest range when the documents support one, then say plainly what would move it up or down. Never a firm final number without a visit.",
  menu: "Use the exact service name and price from the menu in the documents. If the service isn't on the menu, say you'll confirm and don't invent a price.",
  flat_estimate:
    "Give the estimate only if the documents contain pricing for this work. Otherwise say what it depends on and offer to look at it.",
  consult_only:
    "Never mention fees, rates, or cost. Acknowledge, offer the consultation, stop.",
};

export function draftPrompt(profile: TradeProfile, facts: BusinessFacts): string {
  return `You write replies for ${facts.name}, a ${profile.label.toLowerCase()} business in ${facts.serviceArea}. ${facts.ownerName} reads every draft before it goes out, so write what they would send, not a first pass they have to rewrite.

Voice: ${profile.tone}

How this business talks: a ${profile.vocabulary.job} is a "${profile.vocabulary.job}", the person is a "${profile.vocabulary.customer}", an in-person appointment is a "${profile.vocabulary.visit}".

Pricing: ${PRICING_RULE[profile.pricingModel]}

Never:
${profile.neverDo.map((r) => `- ${r}`).join("\n")}

Rules for the reply itself:
- Ask at most one question, and only if you can't be useful without the answer. Two questions is how a lead goes cold.
- No more than six sentences. Most good replies are three.
- No "I hope this email finds you well", no "Thank you for reaching out to us", no restating what they just said back to them.
- Sign off exactly: ${facts.signOff}
- Only state facts that appear in the business information below. If you don't know it, don't fill it in — say what you'll confirm.

Business hours: ${facts.hours}

Business information available to you:
${renderFacts(facts) || "(the business facts sheet is empty — stay general, quote nothing, and offer to confirm details)"}

Return only this JSON, no prose and no code fences:
{"body":"the reply","rationale":"one sentence to the owner explaining why you wrote it this way"}`;
}

export interface DraftResult {
  body: string;
  rationale: string;
}

export async function proposeReply(args: {
  thread: { id: string; subject: string; from: string };
  message: string;
  /** The inbound message's RFC822 Message-ID, so the reply threads properly. */
  inReplyTo: string | null;
  profile: TradeProfile;
  facts: BusinessFacts;
  seatToken: string;
}): Promise<Action> {
  const result = await generateJSON<DraftResult>(
    {
      system: draftPrompt(args.profile, args.facts),
      messages: [{ role: "user", content: args.message }],
      maxTokens: 900,
    },
    args.seatToken,
  );

  const payload: ActionPayload = {
    kind: "draft_reply",
    to: args.thread.from,
    subject: args.thread.subject.startsWith("Re:") ? args.thread.subject : `Re: ${args.thread.subject}`,
    body: result.body,
    inReplyTo: args.inReplyTo,
  };

  return {
    id: crypto.randomUUID(),
    kind: "draft_reply",
    threadId: args.thread.id,
    rationale: result.rationale,
    payload,
    citations: [], // v1 grounds on the facts sheet, so there are no documents to cite.
    status: "pending",
    createdAt: new Date().toISOString(),
    decidedAt: null,
    declineReason: null,
  };
}

/* --------------------------------------------------------------- follow-up */

export function followUpPrompt(profile: TradeProfile, facts: BusinessFacts): string {
  return `You write a short follow-up nudge for ${facts.name}, a ${profile.label.toLowerCase()} business. ${facts.ownerName} already replied to this person and hasn't heard back since. Write one brief, warm check-in — not pushy, not apologetic.

Voice: ${profile.tone}

Rules:
- Two sentences at most.
- Reference the specific ${profile.vocabulary.job} or question from the conversation below — never a generic "just checking in."
- Sign off exactly: ${facts.signOff}
- Only state facts that appear in the conversation. Don't invent new details or a new offer.

Return only this JSON, no prose and no code fences:
{"body":"the nudge","rationale":"one sentence to the owner explaining why this is worth a nudge now"}`;
}

export interface FollowUpResult {
  body: string;
  rationale: string;
}

export async function proposeFollowUp(args: {
  thread: { id: string; subject: string; to: string };
  /** The prior exchange, oldest first, as "Customer: ..." / "You: ..." lines. */
  conversation: string;
  /** The most recent inbound message's Message-ID, so the nudge threads properly. */
  inReplyTo: string | null;
  profile: TradeProfile;
  facts: BusinessFacts;
  seatToken: string;
}): Promise<Action> {
  const result = await generateJSON<FollowUpResult>(
    {
      system: followUpPrompt(args.profile, args.facts),
      messages: [{ role: "user", content: args.conversation }],
      maxTokens: 300,
    },
    args.seatToken,
  );

  const payload: ActionPayload = {
    kind: "follow_up",
    to: args.thread.to,
    body: result.body,
    sendAfter: new Date().toISOString(),
    inReplyTo: args.inReplyTo,
  };

  return {
    id: crypto.randomUUID(),
    kind: "follow_up",
    threadId: args.thread.id,
    rationale: result.rationale,
    payload,
    citations: [],
    status: "pending",
    createdAt: new Date().toISOString(),
    decidedAt: null,
    declineReason: null,
  };
}
