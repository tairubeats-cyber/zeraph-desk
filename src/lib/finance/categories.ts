import type { Category } from "./types";

/**
 * Starting set, written to the database on first run. After that the
 * database is the source of truth: users add, rename and hide categories, and
 * nothing in the app refers to a category by anything but its id.
 */
export const DEFAULT_CATEGORIES: Omit<Category, "position" | "hidden">[] = [
  { id: "housing", name: "Housing", kind: "expense" },
  { id: "transportation", name: "Transportation", kind: "expense" },
  { id: "food", name: "Food", kind: "expense" },
  { id: "dining", name: "Dining", kind: "expense" },
  { id: "shopping", name: "Shopping", kind: "expense" },
  { id: "entertainment", name: "Entertainment", kind: "expense" },
  { id: "healthcare", name: "Healthcare", kind: "expense" },
  { id: "travel", name: "Travel", kind: "expense" },
  { id: "subscriptions", name: "Subscriptions", kind: "expense" },
  { id: "utilities", name: "Utilities", kind: "expense" },
  { id: "insurance", name: "Insurance", kind: "expense" },
  { id: "debt", name: "Debt", kind: "expense" },
  { id: "investments", name: "Investments", kind: "transfer" },
  { id: "income", name: "Income", kind: "income" },
  { id: "transfers", name: "Transfers", kind: "transfer" },
  { id: "other", name: "Other", kind: "expense" },
];

/** Where a transaction lands when its category is missing or has been removed. It can't be hidden. */
export const FALLBACK_CATEGORY_ID = "other";
