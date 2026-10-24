import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { CHANNELS } from '../shared/bridge';
import type { AuraController } from './controller';
import { isAppUrl } from './protocol';

export interface WindowActions {
  showOrb(focus: boolean): void;
  hideOrb(): void;
  openDashboard(): void;
}

const MAX_AUDIO_SAMPLES = 16_000 * 30; // 30 seconds at 16 kHz

const text = z.string().trim().min(1).max(2000);
const conversationId = z.string().min(1).max(64).optional();
const actionId = z.uuid();
const wakeStatus = z.union([
  z.object({
    mode: z.enum(['custom', 'builtin']),
    label: z.string().max(100),
    state: z.enum(['starting', 'listening', 'error']),
    detail: z.string().max(500).optional(),
  }),
  z.object({ mode: z.literal('off'), label: z.null(), state: z.literal('off'), detail: z.string().max(500).optional() }),
]);

/**
 * Connects the window bridge to the controller. Every message is checked:
 * it must come from an Aura page, and its arguments must have the right shape.
 */
export function registerIpc(controller: AuraController, windows: WindowActions): void {
  const handle = <S extends z.ZodType<unknown[]>>(channel: string, schema: S, handler: (...args: z.output<S>) => unknown) => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...raw: unknown[]) => {
      if (!isAppUrl(event.senderFrame?.url)) {
        throw new Error('Blocked a request from a page that is not part of Aura');
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`Invalid request to ${channel}`);
      }
      return handler(...parsed.data);
    });
  };
  const none = z.tuple([]);

  handle(CHANNELS.getState, none, () => controller.refresh());
  handle(CHANNELS.signIn, none, () => controller.signIn());
  handle(CHANNELS.signOut, none, () => controller.signOut());
  handle(CHANNELS.disconnectGoogle, none, () => controller.disconnectGoogle());
  handle(CHANNELS.turn, z.tuple([text, conversationId]), (t, id) => controller.turn(t, id));
  handle(CHANNELS.confirm, z.tuple([actionId, z.boolean()]), (id, approve) => controller.confirm(id, approve));
  handle(CHANNELS.undo, z.tuple([actionId]), (id) => controller.undo(id));
  handle(CHANNELS.activity, none, () => controller.activity());
  handle(
    CHANNELS.transcribe,
    z.tuple([z.instanceof(Float32Array).refine((audio) => audio.length > 0 && audio.length <= MAX_AUDIO_SAMPLES)]),
    (audio) => controller.transcribe(audio),
  );
  handle(CHANNELS.speak, z.tuple([z.string().max(5000)]), (t) => controller.speak(t));
  handle(CHANNELS.stopSpeaking, none, () => controller.stopSpeaking());
  handle(CHANNELS.showOrb, z.tuple([z.boolean()]), (focus) => windows.showOrb(focus));
  handle(CHANNELS.hideOrb, none, () => windows.hideOrb());
  handle(CHANNELS.openDashboard, none, () => windows.openDashboard());
  handle(CHANNELS.wakeConfig, none, () => controller.wakeConfig());
  handle(CHANNELS.reportWake, z.tuple([wakeStatus]), (status) => controller.reportWake(status));
}
