import type { gmail_v1 } from '@googleapis/gmail';

export interface EmailDraft {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
}

const HEADER_BREAK = /[\r\n]/;

/** RFC 2047 encoding for header text that isn't plain ASCII (accents, emoji, other scripts). */
export function encodeHeaderText(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) {
    return value;
  }
  // Split by whole characters so a multi-byte character is never cut in half,
  // and keep each encoded word under the 75-character limit.
  const words: string[] = [];
  let chunk = '';
  for (const char of value) {
    if (Buffer.byteLength(chunk + char, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word, 'utf8').toString('base64')}?=`).join('\r\n ');
}

/**
 * Builds the raw message Gmail's API expects (base64url of an RFC 5322 email).
 * Header values are checked for line breaks: a subject like "Hi\r\nBcc: x@evil"
 * must never be able to add hidden recipients.
 */
export function buildRawEmail(draft: EmailDraft): string {
  const headers: Array<[string, string]> = [['To', draft.to.join(', ')]];
  if (draft.cc && draft.cc.length > 0) {
    headers.push(['Cc', draft.cc.join(', ')]);
  }
  headers.push(['Subject', draft.subject]);
  for (const [name, value] of headers) {
    if (HEADER_BREAK.test(value)) {
      throw new Error(`The email ${name.toLowerCase()} can't contain line breaks`);
    }
  }
  const body = Buffer.from(draft.body.replace(/\r?\n/g, '\r\n'), 'utf8')
    .toString('base64')
    .replace(/.{76}/g, '$&\r\n');
  const message = [
    ...headers.map(([name, value]) => `${name}: ${name === 'Subject' ? encodeHeaderText(value) : value}`),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
  return Buffer.from(message, 'utf8').toString('base64url');
}

export function headerValue(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  const lower = name.toLowerCase();
  return headers?.find((header) => header.name?.toLowerCase() === lower)?.value ?? '';
}

export interface Mailbox {
  name: string | null;
  email: string;
}

/** Parses `"Priya Sharma" <priya@example.com>, sam@example.com`. */
export function parseMailboxes(value: string): Mailbox[] {
  const result: Mailbox[] = [];
  let current = '';
  let inQuotes = false;
  let inAngle = false;
  const flush = () => {
    const text = current.trim();
    current = '';
    if (!text) return;
    const angle = /^(.*)<([^>]+)>\s*$/.exec(text);
    if (angle) {
      const name = angle[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1').trim();
      result.push({ name: name || null, email: angle[2].trim() });
    } else {
      result.push({ name: null, email: text.replace(/^"(.*)"$/, '$1') });
    }
  };
  for (const char of value) {
    if (char === '"' && !inAngle) inQuotes = !inQuotes;
    else if (char === '<' && !inQuotes) inAngle = true;
    else if (char === '>' && !inQuotes) inAngle = false;
    if (char === ',' && !inQuotes && !inAngle) {
      flush();
    } else {
      current += char;
    }
  }
  flush();
  return result;
}

/** "Priya Sharma" for `Priya Sharma <priya@example.com>`, or the address if there is no name. */
export function displayName(value: string): string {
  const [first] = parseMailboxes(value);
  if (!first) return value;
  return first.name ?? first.email;
}

function decodeBody(data: string | null | undefined): string {
  return data ? Buffer.from(data, 'base64url').toString('utf8') : '';
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
      if (code.startsWith('#x') || code.startsWith('#X')) return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)));
      return ENTITIES[code.toLowerCase()] ?? entity;
    });
}

function findPart(part: gmail_v1.Schema$MessagePart | undefined, mimeType: string): gmail_v1.Schema$MessagePart | null {
  if (!part) return null;
  // Parts with a filename are attachments, not the message text.
  if (part.mimeType === mimeType && part.body?.data && !part.filename) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

/** The readable text of an email: the plain-text part if there is one, otherwise the HTML with tags removed. */
export function extractPlainText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  const plain = findPart(payload, 'text/plain');
  const text = plain ? decodeBody(plain.body?.data) : htmlToText(decodeBody(findPart(payload, 'text/html')?.body?.data));
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
