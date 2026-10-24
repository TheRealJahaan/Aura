import type { ClientAction, GoogleService } from '@aura/shared';
import type { z } from 'zod';
import type { GoogleApis } from '../../google/google-apis';

export interface ToolContext {
  userId: string;
  email: string;
  name: string | null;
  timezone: string;
  now: Date;
  /** Google API clients for this user. Connects on first use. */
  google(): Promise<GoogleApis>;
  /** Undoes the most recent action that can be undone. */
  undoLast(): Promise<ToolOutput>;
}

export interface ToolOutput {
  /** What the AI gets back. Kept small, because every token costs time. */
  data: unknown;
  /** A complete spoken answer, used when Aura runs the tool without the AI. */
  say: string;
  /** Google services this result came from, when there are several (the orb shows their colors). */
  services?: GoogleService[];
  /** Things for the desktop app to do, like opening a page. */
  actions?: ClientAction[];
  /** Replaces the `summarize` line in the activity log once the real details are known. */
  logSummary?: string;
  /** Saved in the action log so the action can be undone later. */
  undo?: Record<string, unknown>;
}

/**
 * read: only looks at data.
 * write: changes the user's own data, and can be undone.
 * external: reaches other people (sends an email, invites guests), so Aura asks first.
 */
export type Risk = 'read' | 'write' | 'external';

export interface Tool<I = unknown> {
  name: string;
  description: string;
  schema: z.ZodType<I>;
  service: GoogleService | null;
  risk: Risk;
  /**
   * When true, a successful run is the whole answer: Aura speaks the tool's
   * `say` text without asking the AI to write a reply, which saves a slow
   * second round trip. Tools whose results the AI usually needs to read
   * (searches, lists) leave this off.
   */
  endsTurn?: boolean;
  /** Defaults to "ask when risk is external". */
  needsConfirmation?(input: I): boolean;
  /** Checks that need the user's time zone or clock. Throws ToolError. Runs before Aura asks to confirm. */
  validate?(input: I, ctx: ToolContext): void;
  /** Which Google color the orb shows, when it depends on the input (like which app to open). */
  serviceFor?(input: I): GoogleService | null;
  /**
   * A short lowercase phrase like "send an email to Priya". Used in
   * "I'm about to …" and, capitalized, in the activity log.
   */
  summarize(input: I, ctx: ToolContext): string;
  /** The exact details the user confirms, like recipients and the message text. */
  details?(input: I, ctx: ToolContext): Array<{ label: string; value: string }>;
  run(ctx: ToolContext, input: I): Promise<ToolOutput>;
  /** Reverses a successful run, given its saved `undo` data. Returns what to say. */
  undo?(ctx: ToolContext, data: Record<string, unknown>): Promise<string>;
}

/** An error whose message is safe to say to the user (and to show the AI). */
export class ToolError extends Error {}

/** Keeps the input type of each tool tied to its schema. */
export function defineTool<S extends z.ZodType>(tool: Tool<z.output<S>> & { schema: S }): Tool<z.output<S>> {
  return tool;
}

export function requiresConfirmation<I>(tool: Tool<I>, input: I): boolean {
  return tool.needsConfirmation ? tool.needsConfirmation(input) : tool.risk === 'external';
}
