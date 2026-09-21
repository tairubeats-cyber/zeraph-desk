/**
 * v1 replacement for document indexing. The owner fills this in once, with you,
 * during the paid setup. It goes into the draft prompt whole — no chunking, no
 * embeddings, no retrieval.
 *
 * When a customer's sheet stops fitting comfortably in the prompt, that's the
 * signal to build Phase 2. Not before.
 */
export interface BusinessFacts {
  name: string;
  ownerName: string;
  signOff: string;
  serviceArea: string;
  hours: string;
  phone: string;
  /** What they do, in their words. One line each. */
  services: string[];
  /** Ranges, not promises. "Gutter replacement, 2,000 sq ft home: $1,400–1,900" */
  pricing: string[];
  /** Jobs they turn down. Keeps drafts from accepting work they don't want. */
  wontDo: string[];
  /** Anything a reply should know: deposits, warranty, lead time, financing. */
  policies: string[];
  /** Paste-in space for anything that didn't fit the boxes above. */
  notes: string;
}

export const EMPTY_FACTS: BusinessFacts = {
  name: "",
  ownerName: "",
  signOff: "",
  serviceArea: "",
  hours: "",
  phone: "",
  services: [],
  pricing: [],
  wontDo: [],
  policies: [],
  notes: "",
};

/** Rendered into the system prompt as the grounding block. */
export function renderFacts(f: BusinessFacts): string {
  const block = (title: string, lines: string[]) =>
    lines.filter(Boolean).length ? `${title}:\n${lines.filter(Boolean).map((l) => `- ${l}`).join("\n")}` : "";

  return [
    `Business: ${f.name}`,
    `Owner: ${f.ownerName}`,
    `Phone: ${f.phone}`,
    `Service area: ${f.serviceArea}`,
    `Hours: ${f.hours}`,
    block("Services", f.services),
    block("Pricing", f.pricing),
    block("Work this business does not take", f.wontDo),
    block("Policies", f.policies),
    f.notes.trim() ? `Other notes:\n${f.notes.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Rough guard: if the sheet gets this big, revisit retrieval. */
export function isOversized(f: BusinessFacts): boolean {
  return renderFacts(f).length > 20_000;
}
