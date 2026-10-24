import type { GoogleService } from '@aura/shared';

const API = 'https://www.googleapis.com/auth';

// What Aura asks Google for, service by service. Each scope is the narrowest
// one that still lets the feature work (for example, Drive is metadata-only:
// Aura can find your files by name but cannot read or change them).
export const SERVICE_SCOPES: Record<Exclude<GoogleService, 'meet'>, string[]> = {
  gmail: [`${API}/gmail.readonly`, `${API}/gmail.send`],
  calendar: [`${API}/calendar.events`],
  tasks: [`${API}/tasks`],
  drive: [`${API}/drive.metadata.readonly`],
  contacts: [`${API}/contacts.readonly`, `${API}/contacts.other.readonly`],
};

// Meet links are created through Calendar events, so Meet needs the Calendar scope.
export function scopesForService(service: GoogleService): string[] {
  return service === 'meet' ? SERVICE_SCOPES.calendar : SERVICE_SCOPES[service];
}

export const GOOGLE_SCOPES = ['openid', 'email', 'profile', ...Object.values(SERVICE_SCOPES).flat()];

export function missingServices(granted: string[]): GoogleService[] {
  const have = new Set(granted);
  return (Object.keys(SERVICE_SCOPES) as Exclude<GoogleService, 'meet'>[]).filter((service) =>
    SERVICE_SCOPES[service].some((scope) => !have.has(scope)),
  );
}
