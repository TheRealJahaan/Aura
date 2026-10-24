import { Menu, nativeImage, Tray } from 'electron';
import { join } from 'node:path';

export interface TrayActions {
  listen(): void;
  type(): void;
  openDashboard(): void;
  quit(): void;
}

/** The Aura icon in the menu bar. */
export function createTray(assetsDir: string, hotkey: string, actions: TrayActions): Tray {
  // "Template" images are drawn in black and recolored by macOS for light and dark menu bars.
  const icon = nativeImage.createFromPath(join(assetsDir, 'trayTemplate.png'));
  icon.setTemplateImage(true);
  const tray = new Tray(icon);
  tray.setToolTip('Aura');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Listen', accelerator: hotkey, click: actions.listen },
      { label: 'Type a command…', click: actions.type },
      { label: 'Open Aura', click: actions.openDashboard },
      { type: 'separator' },
      { label: 'Quit Aura', click: actions.quit },
    ]),
  );
  return tray;
}
