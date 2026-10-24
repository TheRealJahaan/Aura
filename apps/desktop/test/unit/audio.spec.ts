import { EndpointDetector, int16ToFloat32, rms } from '../../src/shared/audio';

const FRAME = 512; // 32 ms at 16 kHz
const silence = () => new Int16Array(FRAME).map(() => Math.round((Math.random() - 0.5) * 60));
const speech = () => new Int16Array(FRAME).map((_, i) => Math.round(Math.sin(i / 3) * 8000));
const feedMs = (d: EndpointDetector, make: () => Int16Array, ms: number) => {
  let state = d.feed(make());
  for (let t = 32; t < ms; t += 32) state = d.feed(make());
  return state;
};

describe('audio helpers', () => {
  it('converts 16-bit samples to floats', () => {
    expect(Array.from(int16ToFloat32(new Int16Array([0, 16384, -32768])))).toEqual([0, 0.5, -1]);
  });
  it('measures loudness', () => {
    expect(rms(new Int16Array(10))).toBe(0);
    expect(rms(new Int16Array(10).fill(16384))).toBeCloseTo(0.5);
  });
});

describe('EndpointDetector', () => {
  it('ends after speech followed by silence', () => {
    const d = new EndpointDetector();
    expect(feedMs(d, silence, 300)).toBe('listening');
    expect(feedMs(d, speech, 1000)).toBe('listening');
    expect(d.speechStarted).toBe(true);
    expect(feedMs(d, silence, 1000)).toBe('done');
    expect(d.audio().length).toBeGreaterThan(16_000 * 2);
  });

  it('gives up when nobody speaks', () => {
    expect(feedMs(new EndpointDetector(), silence, 6100)).toBe('no-speech');
  });

  it('ignores a short click', () => {
    const d = new EndpointDetector();
    feedMs(d, silence, 300);
    d.feed(speech());
    expect(feedMs(d, silence, 2000)).toBe('listening');
    expect(d.speechStarted).toBe(false);
  });

  it('stops at the maximum length', () => {
    expect(feedMs(new EndpointDetector({ maxMs: 3000 }), speech, 3100)).toBe('done');
  });
});
