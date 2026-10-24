import type { people_v1 } from '@googleapis/people';
import { z } from 'zod';
import { plural, speakList } from '../../common/time';
import { defineTool } from './tool';

const READ_MASK = 'names,emailAddresses';
const WARM_FOR_MS = 10 * 60_000;
const warmedAt = new Map<string, number>();

export interface Contact {
  name: string | null;
  emails: string[];
}

function toContact(person: people_v1.Schema$Person | undefined): Contact | null {
  const emails = (person?.emailAddresses ?? []).map((entry) => entry.value?.trim()).filter((v): v is string => !!v);
  if (emails.length === 0) return null;
  return { name: person?.names?.[0]?.displayName ?? null, emails };
}

/**
 * Google's contact search reads from a cache that it fills on an empty
 * "warmup" search, so the first search after a while needs one.
 */
async function warmUp(people: people_v1.People, userId: string, now: number): Promise<void> {
  if ((warmedAt.get(userId) ?? 0) > now - WARM_FOR_MS) return;
  await Promise.allSettled([
    people.people.searchContacts({ query: '', readMask: READ_MASK, pageSize: 1 }),
    people.otherContacts.search({ query: '', readMask: READ_MASK, pageSize: 1 }),
  ]);
  warmedAt.set(userId, now);
}

export const contactsSearch = defineTool({
  name: 'contacts_search',
  description:
    "Look up people in the user's Google Contacts and the people they've emailed, to find an email address from a name.",
  schema: z.object({
    query: z.string().trim().min(1).max(100).describe('A name or part of an email address'),
  }),
  service: 'contacts',
  risk: 'read',
  summarize: (input) => `look up ${input.query} in your contacts`,
  async run(ctx, input) {
    const { people } = await ctx.google();
    await warmUp(people, ctx.userId, ctx.now.getTime());
    const [saved, other] = await Promise.allSettled([
      people.people.searchContacts({ query: input.query, readMask: READ_MASK, pageSize: 10 }),
      people.otherContacts.search({ query: input.query, readMask: READ_MASK, pageSize: 10 }),
    ]);
    if (saved.status === 'rejected' && other.status === 'rejected') {
      throw saved.reason;
    }
    const results = [
      ...(saved.status === 'fulfilled' ? (saved.value.data.results ?? []) : []),
      ...(other.status === 'fulfilled' ? (other.value.data.results ?? []) : []),
    ];
    const seen = new Set<string>();
    const contacts: Contact[] = [];
    for (const result of results) {
      const contact = toContact(result.person);
      if (!contact) continue;
      const fresh = contact.emails.filter((email) => !seen.has(email.toLowerCase()));
      fresh.forEach((email) => seen.add(email.toLowerCase()));
      if (fresh.length > 0) contacts.push({ ...contact, emails: fresh });
      if (contacts.length >= 5) break;
    }
    if (contacts.length === 0) {
      return { data: { contacts: [] }, say: `I couldn't find anyone called ${input.query} in your contacts.` };
    }
    const label = (contact: Contact) => (contact.name ? `${contact.name} at ${contact.emails[0]}` : contact.emails[0]);
    const say =
      contacts.length === 1
        ? `I found ${label(contacts[0])}.`
        : `I found ${plural(contacts.length, 'person', 'people')}: ${speakList(contacts.map(label))}.`;
    return { data: { contacts }, say };
  },
});

export const contactsTools = [contactsSearch];
