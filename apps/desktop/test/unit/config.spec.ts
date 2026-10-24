import { parseConfig } from '../../src/main/config';
import { orbColors, prettyHotkey } from '../../src/renderer/colors';
import { isAppUrl, resolveInside } from '../../src/main/protocol';

describe('desktop config', () => {
  it('has safe defaults', () => {
    expect(parseConfig({})).toEqual({
      apiUrl: 'http://127.0.0.1:3000',
      picovoiceAccessKey: null,
      wakeWordPath: null,
      wakeWordBuiltin: 'Computer',
      wakeWordSensitivity: 0.6,
      hotkey: 'Alt+Space',
      whisperModel: 'Xenova/whisper-base.en',
      voice: null,
      speak: true,
    });
  });
  it('treats empty values as unset', () => {
    expect(parseConfig({ PICOVOICE_ACCESS_KEY: '  ', AURA_VOICE: '' }).picovoiceAccessKey).toBeNull();
  });
  it('refuses to send the token over plain http to another machine', () => {
    expect(() => parseConfig({ AURA_API_URL: 'http://192.168.1.5:3000' })).toThrow('AURA_API_URL');
    expect(parseConfig({ AURA_API_URL: 'https://aura.example.com/' }).apiUrl).toBe('https://aura.example.com');
  });
  it('rejects unknown wake words', () => {
    expect(() => parseConfig({ WAKE_WORD_BUILTIN: 'Hey Aura' })).toThrow('WAKE_WORD_BUILTIN');
  });
});

describe('aura:// protocol', () => {
  it('serves files inside the app folder only', () => {
    expect(resolveInside('/app/r', '/orb.html')).toBe('/app/r/orb.html');
    expect(resolveInside('/app/r', '/chunks/a.js')).toBe('/app/r/chunks/a.js');
    expect(resolveInside('/app/r', '/../../etc/passwd')).toBeNull();
    expect(resolveInside('/app/r', '/%2e%2e/%2e%2e/etc/passwd')).toBeNull();
    expect(resolveInside('/app/r', '/chunks/../orb.html')).toBe('/app/r/orb.html');
    expect(resolveInside('/app/r', '/')).toBeNull();
    expect(resolveInside('/app/r', '/a%00b')).toBeNull();
    expect(resolveInside('/app/r', '/%E0%A4%A')).toBeNull();
  });
  it('recognizes Aura pages', () => {
    expect(isAppUrl('aura://app/orb.html')).toBe(true);
    expect(isAppUrl('https://app/orb.html')).toBe(false);
    expect(isAppUrl('aura://evil/orb.html')).toBe(false);
    expect(isAppUrl(undefined)).toBe(false);
  });
});

describe('orb colors', () => {
  it('uses Aura colors, a service palette, or a blend', () => {
    expect(orbColors([])[0]).toBe('#7C5CFF');
    expect(orbColors(['gmail'])[0]).toBe('#EA4335');
    expect(orbColors(['calendar', 'gmail'])).toEqual(['#4285F4', '#EA4335', '#4285F4', '#EA4335']);
  });
  it('shows hotkeys with Mac symbols', () => {
    expect(prettyHotkey('Alt+Space')).toBe('⌥ Space');
    expect(prettyHotkey('CommandOrControl+Shift+A')).toBe('⌘ ⇧ A');
    expect(prettyHotkey('Alt+Space', false)).toBe('Alt + Space');
  });
});
