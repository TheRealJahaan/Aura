import { z } from 'zod';
import { ParsedDateTime, parseDateTimeInput } from '../../common/time';

// Shared input types for tools. The AI sometimes produces odd values, so each
// one is checked here and a clear message goes back to it so it can retry.

export const emailAddress = z.email({ message: 'must be a full email address like name@example.com' }).max(254);

export const dateTimeInput = z
  .string()
  .trim()
  .refine((value) => parseDateTimeInput(value, 'UTC') !== null, {
    message: 'use a date like 2026-10-24 or a local date and time like 2026-10-24T15:00',
  });

export const dateInput = z
  .string()
  .trim()
  .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && parseDateTimeInput(value, 'UTC') !== null, {
    message: 'use a date like 2026-10-24',
  });

/** Reads a value that already passed `dateTimeInput`, in the user's time zone. */
export function readDateTime(value: string, timeZone: string): ParsedDateTime {
  const parsed = parseDateTimeInput(value, timeZone);
  if (!parsed) {
    throw new Error(`Unchecked date input: ${value}`);
  }
  return parsed;
}
