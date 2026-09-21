/**
 * Everything that differs between industries lives here, and nowhere else.
 * The engine (classify -> draft -> queue) is identical across all of them.
 * Adding a trade means writing a profile, not forking the app.
 *
 * Ship order is deliberate: home_services first, professional_office last.
 * Sell one, then turn the next one on.
 */

export type TradeId = "home_services" | "auto" | "beauty_wellness" | "professional_office";

export type PricingModel =
  | "range_then_visit" // can give a ballpark, must confirm on site
  | "menu" // published per-service prices
  | "flat_estimate" // firm number from a few known inputs
  | "consult_only"; // never quote in a reply, book the consult

export interface TradeProfile {
  id: TradeId;
  label: string;
  /** What the owner calls the work. Used in drafts so it doesn't sound imported. */
  vocabulary: { job: string; customer: string; visit: string };
  /** Must be known before a useful reply exists. Missing ones become the question. */
  intakeFields: string[];
  pricingModel: PricingModel;
  /** Hours of silence before a follow-up is proposed. */
  followUpAfterHours: number;
  askForReview: boolean;
  /** Voice guidance, written as the owner would recognize it. */
  tone: string;
  /** Hard limits. These become refusals in the prompt, not suggestions. */
  neverDo: string[];
}

export const TRADES: Record<TradeId, TradeProfile> = {
  home_services: {
    id: "home_services",
    label: "Home services",
    vocabulary: { job: "job", customer: "homeowner", visit: "estimate" },
    intakeFields: ["address or town", "what needs doing", "size or scope", "how soon", "photos"],
    pricingModel: "range_then_visit",
    followUpAfterHours: 48,
    askForReview: true,
    tone: "Direct and unfussy. Short sentences. Give a real range instead of dodging, then say what would change it. No sales language.",
    neverDo: [
      "Give a firm final price without a site visit.",
      "Promise a date the owner hasn't confirmed.",
      "Guess at code or permit requirements.",
    ],
  },

  auto: {
    id: "auto",
    label: "Auto",
    vocabulary: { job: "service", customer: "customer", visit: "drop-off" },
    intakeFields: ["year, make, model", "what's wrong or what's wanted", "mileage", "when they need the car back"],
    pricingModel: "flat_estimate",
    followUpAfterHours: 24,
    askForReview: true,
    tone: "Plain and confident. Car people hate being talked down to. Name the likely cause, name what it costs, say what would change it.",
    neverDo: [
      "Diagnose a fault from a description alone as if it were certain.",
      "Quote parts pricing that isn't in the owner's files.",
      "Advise on whether a car is safe to drive.",
    ],
  },

  beauty_wellness: {
    id: "beauty_wellness",
    label: "Salons, spas, med spas",
    vocabulary: { job: "appointment", customer: "client", visit: "consultation" },
    intakeFields: ["service wanted", "first time or returning", "preferred days and times", "who they usually see"],
    pricingModel: "menu",
    followUpAfterHours: 24,
    askForReview: true,
    tone: "Warm and unhurried, still efficient. Use the client's name. Confirm the service by its menu name so there's no mix-up.",
    neverDo: [
      "Give medical, dermatological, or treatment advice of any kind.",
      "Promise a result from a treatment.",
      "Discuss anything a client shared about a condition, medication, or their body.",
      "Confirm a booking the calendar hasn't confirmed.",
    ],
  },

  professional_office: {
    id: "professional_office",
    label: "Professional offices",
    vocabulary: { job: "matter", customer: "client", visit: "consultation" },
    intakeFields: ["general nature of the need", "any deadline", "best times to talk"],
    pricingModel: "consult_only",
    followUpAfterHours: 72,
    askForReview: false,
    tone: "Measured and brief. Acknowledge, set the next step, stop. Do not editorialize about the person's situation.",
    neverDo: [
      "Give legal, tax, accounting, or insurance advice, or anything that reads as it.",
      "Quote a fee.",
      "Confirm representation, engagement, or that the office is taking the matter.",
      "Repeat sensitive details the sender shared back to them in writing.",
      "Respond at all before the office has run its conflict check — flag these for the owner instead.",
    ],
  },
};
