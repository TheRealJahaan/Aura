import { GoogleService, isAllowedOpenUrl } from '@aura/shared';
import { z } from 'zod';
import { appLabel, appLink, GOOGLE_APPS, GoogleApp, withAccount } from '../../google/links';
import { defineTool, ToolError } from './tool';

const APP_SERVICE: Partial<Record<GoogleApp, GoogleService>> = {
  gmail: 'gmail',
  calendar: 'calendar',
  drive: 'drive',
  docs: 'drive',
  sheets: 'drive',
  slides: 'drive',
  meet: 'meet',
  tasks: 'tasks',
  contacts: 'contacts',
};

export function serviceForApp(app: GoogleApp): GoogleService | null {
  return APP_SERVICE[app] ?? null;
}

export const openApp = defineTool({
  name: 'open_app',
  description: 'Open a Google app in the browser on the user\'s Mac, signed in to their account. Example: "open mail" opens Gmail.',
  schema: z.object({
    app: z.enum(GOOGLE_APPS as [GoogleApp, ...GoogleApp[]]),
  }),
  service: null,
  risk: 'read',
  endsTurn: true,
  serviceFor: (input) => serviceForApp(input.app),
  summarize: (input) => `open ${appLabel(input.app)}`,
  async run(ctx, input) {
    const link = appLink(input.app, ctx.email);
    return {
      data: { opened: link.label },
      say: `Opening ${link.label}.`,
      actions: [{ type: 'open_url', url: link.url, label: link.label }],
    };
  },
});

export const openLink = defineTool({
  name: 'open_link',
  description:
    'Open a Google link from an earlier result (an email, event, Meet or Drive link) in the browser. Only Google pages can be opened.',
  schema: z.object({
    url: z.string().trim().max(2000),
    label: z.string().trim().max(100).default('the link'),
  }),
  service: null,
  risk: 'read',
  endsTurn: true,
  summarize: (input) => `open ${input.label}`,
  async run(_ctx, input) {
    if (!isAllowedOpenUrl(input.url)) {
      throw new ToolError('For your safety I only open Google pages like Gmail, Calendar, Meet and Drive.');
    }
    return {
      data: { opened: input.url },
      say: `Opening ${input.label}.`,
      actions: [{ type: 'open_url', url: input.url, label: input.label }],
    };
  },
});

export const meetStart = defineTool({
  name: 'meet_start',
  description: 'Start a new instant Google Meet video call in the browser.',
  schema: z.object({}),
  service: 'meet',
  risk: 'read',
  endsTurn: true,
  summarize: () => 'start a new Google Meet',
  async run(ctx) {
    const url = withAccount('https://meet.google.com/new', ctx.email);
    return {
      data: { opened: url },
      say: 'Starting a new Google Meet. Share the link from the meeting window.',
      actions: [{ type: 'open_url', url, label: 'New Google Meet' }],
    };
  },
});

export const undoLastAction = defineTool({
  name: 'undo_last_action',
  description: "Undo the last change Aura made (an event, task or checked-off task). Sent emails can't be unsent.",
  schema: z.object({}),
  service: null,
  // The undo is recorded on the original action, so this tool isn't logged on its own.
  risk: 'read',
  endsTurn: true,
  summarize: () => 'undo the last action',
  run: (ctx) => ctx.undoLast(),
});

export const openTools = [openApp, openLink, meetStart, undoLastAction];
