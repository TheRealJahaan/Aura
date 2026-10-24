import type { GoogleService } from '../shared/bridge';

// The orb glows in the colors of whatever Aura is working with.
export const AURA_COLORS = ['#7C5CFF', '#22D3EE', '#F472B6', '#A78BFA'];

export const SERVICE_COLORS: Record<GoogleService, string[]> = {
  gmail: ['#EA4335', '#FF7B6B', '#FBBC04', '#EA4335'],
  calendar: ['#4285F4', '#8AB4F8', '#1A73E8', '#4285F4'],
  tasks: ['#4285F4', '#FBBC04', '#1A73E8', '#FBBC04'],
  drive: ['#34A853', '#FBBC04', '#4285F4', '#34A853'],
  contacts: ['#4285F4', '#8AB4F8', '#34A853', '#4285F4'],
  meet: ['#34A853', '#00897B', '#FBBC04', '#34A853'],
};

export const ERROR_COLORS = ['#EF4444', '#F97316', '#EF4444', '#B91C1C'];

/** Up to four colors for the orb. Several services blend their colors; none means Aura's own. */
export function orbColors(services: GoogleService[]): string[] {
  if (services.length === 0) return AURA_COLORS;
  if (services.length === 1) return SERVICE_COLORS[services[0]];
  const mixed = services.slice(0, 4).map((service) => SERVICE_COLORS[service][0]);
  while (mixed.length < 4) mixed.push(mixed[mixed.length % services.length]);
  return mixed;
}

/** "Alt+Space" → "⌥ Space" on a Mac. */
export function prettyHotkey(accelerator: string, mac = true): string {
  if (!mac) return accelerator.replace(/\+/g, ' + ');
  const symbols: Record<string, string> = {
    Alt: '⌥', Option: '⌥', Command: '⌘', Cmd: '⌘', CommandOrControl: '⌘', CmdOrCtrl: '⌘',
    Control: '⌃', Ctrl: '⌃', Shift: '⇧', Space: 'Space',
  };
  return accelerator
    .split('+')
    .map((key) => symbols[key] ?? key)
    .join(' ');
}
