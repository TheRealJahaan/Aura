import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { AppState, AuraBridge, CHANNELS, EVENTS } from '../shared/bridge';

// The bridge between an Aura page and the main process. Pages get these
// functions and nothing else: no Node, no Electron, no file system.

function subscribe<T extends unknown[]>(channel: string, callback: (...args: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, ...args: unknown[]) => callback(...(args as T));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const bridge: AuraBridge = {
  getState: () => ipcRenderer.invoke(CHANNELS.getState),
  signIn: () => ipcRenderer.invoke(CHANNELS.signIn),
  signOut: () => ipcRenderer.invoke(CHANNELS.signOut),
  disconnectGoogle: () => ipcRenderer.invoke(CHANNELS.disconnectGoogle),
  turn: (text, conversationId) => ipcRenderer.invoke(CHANNELS.turn, text, conversationId),
  confirm: (actionId, approve) => ipcRenderer.invoke(CHANNELS.confirm, actionId, approve),
  undo: (actionId) => ipcRenderer.invoke(CHANNELS.undo, actionId),
  activity: () => ipcRenderer.invoke(CHANNELS.activity),
  transcribe: (audio) => ipcRenderer.invoke(CHANNELS.transcribe, audio),
  speak: (text) => ipcRenderer.invoke(CHANNELS.speak, text),
  stopSpeaking: () => ipcRenderer.invoke(CHANNELS.stopSpeaking),
  showOrb: (focus) => ipcRenderer.invoke(CHANNELS.showOrb, focus),
  hideOrb: () => ipcRenderer.invoke(CHANNELS.hideOrb),
  openDashboard: () => ipcRenderer.invoke(CHANNELS.openDashboard),
  wakeConfig: () => ipcRenderer.invoke(CHANNELS.wakeConfig),
  reportWake: (status) => ipcRenderer.invoke(CHANNELS.reportWake, status),
  onListen: (callback) => subscribe(EVENTS.listen, callback),
  onType: (callback) => subscribe(EVENTS.type, callback),
  onSpeechDone: (callback) => subscribe(EVENTS.speechDone, callback),
  onStateChanged: (callback) => subscribe<[AppState]>(EVENTS.stateChanged, callback),
};

contextBridge.exposeInMainWorld('aura', bridge);
