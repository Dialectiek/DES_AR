// Short feedback sounds, made with WebAudio (no sound files): a few notes per event.
// Browser only. Browsers start audio only after a user gesture, so call unlock() from one
// (the Start button, the first click on a screen); play() before that is silent.
//
//   const sounds = createSounds({ enabled: true });
//   sounds.unlock();            // in a click handler
//   sounds.play('connect');
//
// Mute: ?sound=0 in the URL, or the toolbar's sound button on a screen (saved in localStorage).

// name → notes: [frequency Hz, start s, length s, wave, volume]
const SOUNDS = {
  pick:       [[880, 0, 0.05, 'sine', 0.25]],
  place:      [[520, 0, 0.07, 'triangle', 0.35], [780, 0.06, 0.09, 'triangle', 0.3]],
  lift:       [[440, 0, 0.06, 'sine', 0.25], [660, 0.05, 0.06, 'sine', 0.2]],
  turn:       [[700, 0, 0.04, 'square', 0.12]],
  connect:    [[523, 0, 0.08, 'sine', 0.3], [659, 0.07, 0.08, 'sine', 0.3], [784, 0.14, 0.12, 'sine', 0.3]],
  disconnect: [[784, 0, 0.08, 'sine', 0.3], [523, 0.07, 0.12, 'sine', 0.3]],
  refused:    [[220, 0, 0.12, 'sawtooth', 0.15], [196, 0.11, 0.16, 'sawtooth', 0.15]],
  undo:       [[600, 0, 0.06, 'triangle', 0.3], [450, 0.05, 0.08, 'triangle', 0.3]],
  save:       [[660, 0, 0.08, 'sine', 0.3], [990, 0.08, 0.16, 'sine', 0.3]],
  done:       [[523, 0, 0.1, 'sine', 0.3], [784, 0.09, 0.1, 'sine', 0.3], [1047, 0.18, 0.18, 'sine', 0.3]],
};

export const SOUND_NAMES = Object.keys(SOUNDS);

export function createSounds({ enabled = true } = {}) {
  let ctx = null;
  let master = null;
  let on = enabled;

  function unlock() {
    if (ctx || typeof window === 'undefined') {
      if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
  }

  function play(name) {
    const notes = SOUNDS[name];
    if (!on || !notes || !ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + 0.01;
    for (const [freq, start, length, wave, volume] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = wave;
      osc.frequency.value = freq;
      // Short attack and decay, so the notes don't click.
      const a = t0 + start, b = a + length;
      gain.gain.setValueAtTime(0, a);
      gain.gain.linearRampToValueAtTime(volume, a + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, b);
      osc.connect(gain).connect(master);
      osc.start(a);
      osc.stop(b + 0.02);
    }
  }

  return {
    unlock,
    play,
    get enabled() { return on; },
    set enabled(v) { on = !!v; },
  };
}
