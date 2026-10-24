// Aura only ever opens Google pages. Both the API and the desktop app check
// every link against this list, so an email can't trick Aura into opening
// some other website.
const ALLOWED_HOSTS = new Set([
  'mail.google.com',
  'calendar.google.com',
  'meet.google.com',
  'drive.google.com',
  'docs.google.com',
  'tasks.google.com',
  'contacts.google.com',
  'keep.google.com',
  'photos.google.com',
  'www.google.com',
]);

export function isAllowedOpenUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    return false;
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    return false;
  }
  // Calendar event links from the API look like https://www.google.com/calendar/event?eid=...
  if (url.hostname === 'www.google.com' && !url.pathname.startsWith('/calendar/')) {
    return false;
  }
  return true;
}
