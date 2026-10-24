// Links that open the right Google account even when several are signed in
// to the browser (`authuser` picks the account by email address).

export type GoogleApp = 'gmail' | 'calendar' | 'drive' | 'meet' | 'tasks' | 'contacts' | 'docs' | 'sheets' | 'slides' | 'keep';

const APP_URLS: Record<GoogleApp, { url: string; label: string }> = {
  gmail: { url: 'https://mail.google.com/mail/u/', label: 'Gmail' },
  calendar: { url: 'https://calendar.google.com/calendar/r', label: 'Google Calendar' },
  drive: { url: 'https://drive.google.com/drive/', label: 'Google Drive' },
  meet: { url: 'https://meet.google.com/', label: 'Google Meet' },
  tasks: { url: 'https://tasks.google.com/', label: 'Google Tasks' },
  contacts: { url: 'https://contacts.google.com/', label: 'Google Contacts' },
  docs: { url: 'https://docs.google.com/document/', label: 'Google Docs' },
  sheets: { url: 'https://docs.google.com/spreadsheets/', label: 'Google Sheets' },
  slides: { url: 'https://docs.google.com/presentation/', label: 'Google Slides' },
  keep: { url: 'https://keep.google.com/', label: 'Google Keep' },
};

export const GOOGLE_APPS = Object.keys(APP_URLS) as GoogleApp[];

export function withAccount(url: string, email: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('authuser', email);
  return parsed.toString();
}

export function appLabel(app: GoogleApp): string {
  return APP_URLS[app].label;
}

export function appLink(app: GoogleApp, email: string): { url: string; label: string } {
  const { url, label } = APP_URLS[app];
  return { url: withAccount(url, email), label };
}

export function gmailThreadLink(threadId: string, email: string): string {
  const url = new URL(withAccount('https://mail.google.com/mail/u/', email));
  url.hash = `all/${threadId}`;
  return url.toString();
}
