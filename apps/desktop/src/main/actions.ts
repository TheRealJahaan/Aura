import { isAllowedOpenUrl, type ClientAction } from '@aura/shared';

/**
 * Opens what the API asked for, in the user's default browser. The link is
 * checked again here, so even a compromised server can only open Google pages.
 */
export async function runActions(actions: ClientAction[], open: (url: string) => Promise<void>): Promise<string[]> {
  const opened: string[] = [];
  for (const action of actions) {
    if (action.type === 'open_url' && isAllowedOpenUrl(action.url)) {
      await open(action.url);
      opened.push(action.url);
    }
  }
  return opened;
}
