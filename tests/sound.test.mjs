import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSounds, SOUND_NAMES } from '../sound.js';

// A stand-in for WebAudio that counts the notes started.
function fakeAudio() {
  const started = [];
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ gain: param(), frequency: param(), connect(n) { return n; } });
  class AudioContext {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = node(); }
    createGain() { return node(); }
    createOscillator() {
      const o = node();
      o.start = (t) => started.push(t);
      o.stop = () => {};
      return o;
    }
    resume() { return Promise.resolve(); }
  }
  return { started, window: { AudioContext } };
}

test('sounds: silent before unlock and when muted, notes after', () => {
  const fake = fakeAudio();
  globalThis.window = fake.window;
  try {
    const s = createSounds({ enabled: true });
    s.play('connect');
    assert.equal(fake.started.length, 0); // no gesture yet
    s.unlock();
    s.play('connect');
    assert.equal(fake.started.length, 3);
    s.enabled = false;
    s.play('connect');
    s.play('nonsense');
    assert.equal(fake.started.length, 3);
    s.enabled = true;
    for (const name of SOUND_NAMES) s.play(name);
    assert.ok(fake.started.length > 3 + SOUND_NAMES.length - 1);
  } finally {
    delete globalThis.window;
  }
});
