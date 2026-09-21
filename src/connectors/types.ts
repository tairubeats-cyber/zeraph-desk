import type { Message, Thread, Contact } from "../lib/types";
import type { Action } from "../lib/actions";

/**
 * A connector is the only thing that talks to the outside world.
 * It pulls raw items in and normalizes them; it pushes approved actions out.
 * It knows nothing about React and nothing about the model.
 */
export interface Connector {
  id: string;
  label: string;

  /** Is the owner signed in / is the folder chosen? */
  isConnected(): Promise<boolean>;

  /** Anything new since the last cursor. */
  pull(since: string | null): Promise<PullResult>;

  /** Can this connector carry out this action? */
  canSend(action: Action): boolean;

  /** Only ever called after a human approval. */
  send(action: Action): Promise<void>;
}

export interface PullResult {
  contacts: Contact[];
  threads: Thread[];
  messages: Message[];
  cursor: string | null;
}
