/**
 * Zero-dependency Web Audio sound engine. Synthesizes all UI / game sounds from
 * oscillators + filtered noise. The AudioContext is created lazily on first use
 * and resumed inside a user gesture via `unlockAudio`. Everything degrades
 * gracefully (no-ops) when audio is unavailable (SSR, privacy mode, failures).
 */

import { readPersistent, writePersistent } from "@/lib/pluginHost";

export type SfxEvent =
  | "place_player"
  | "place_ai"
  | "victory"
  | "defeat"
  | "draw"
  | "ui_click"
  | "achievement"
  | "hover"
  | "thinking_start"
  | "thinking_end"
  | "undo"
  | "unmute_tick";

const STORAGE_KEY = "audio-muted";

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let muted = false;
let active = true;

function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const AC: typeof AudioContext | undefined =
      typeof window !== "undefined"
        ? window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext
        : undefined;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = muted || !active ? 0 : 0.7;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 6000;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    comp.knee.value = 12;

    masterGain.connect(lp);
    lp.connect(comp);
    comp.connect(ctx.destination);
  } catch {
    ctx = null;
    masterGain = null;
  }
  return ctx;
}

/** Resume the context inside a user gesture (required by browser autoplay). */
export function unlockAudio(): void {
  const c = getCtx();
  if (!c) return;
  try {
    if (c.state === "suspended") void c.resume();
  } catch {
    /* ignore */
  }
}

/** Toggle mute. Persisted in the ZTools plugin store; smoothing avoids a click. */
export function setMuted(value: boolean): void {
  muted = value;
  writePersistent(STORAGE_KEY, value);
  if (masterGain && ctx) {
    try {
      masterGain.gain.setTargetAtTime(value || !active ? 0 : 0.7, ctx.currentTime, 0.02);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Pause or resume all generated audio with the plugin lifecycle.
 * @param value Whether the plugin is currently active.
 * @returns No value.
 */
export function setAudioActive(value: boolean): void {
  active = value;
  if (masterGain && ctx) {
    try {
      masterGain.gain.setTargetAtTime(muted || !active ? 0 : 0.7, ctx.currentTime, 0.02);
      if (!active && ctx.state === "running") void ctx.suspend();
      if (active && ctx.state === "suspended") void ctx.resume();
    } catch {
      /* ignore */
    }
  }
}

export function isMuted(): boolean {
  return muted;
}

function initMutedFromStorage(): void {
  muted = readPersistent<unknown>(STORAGE_KEY, false) === true;
}
initMutedFromStorage();

function makeNoise(c: AudioContext, dur: number): AudioBufferSourceNode {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  return src;
}

interface BlipOpts {
  type?: OscillatorType;
  f0: number;
  f1?: number; // glide target (exponential)
  t0: number; // absolute ctx time
  dur: number; // seconds
  a: number; // attack (s)
  d: number; // decay to ~0 (s)
  peak: number;
  lp?: number; // lowpass cutoff
  noise?: { hp: number; gain: number; dur: number; t: number };
  sub?: { f: number; gain: number; type?: OscillatorType };
  detune?: number; // cents slide (e.g. +4% up)
  partials?: { mult: number; gain: number; type?: OscillatorType }[];
}

function blip(c: AudioContext, o: BlipOpts): void {
  const now = o.t0;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(o.peak, now + o.a);
  g.gain.linearRampToValueAtTime(0.0001, now + o.a + o.d);

  let node: AudioNode = g;
  let lp: BiquadFilterNode | null = null;
  if (o.lp) {
    lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = o.lp;
    g.connect(lp);
    node = lp;
  }
  node.connect(masterGain!);

  const spawnOsc = (
    freq: number,
    type: OscillatorType,
    gain: number,
    glideTo?: number
  ): void => {
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (glideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(0.0001, glideTo),
        now + o.a + o.d
      );
    }
    if (o.detune) {
      osc.detune.setValueAtTime(0, now);
      osc.detune.linearRampToValueAtTime(o.detune, now + o.dur);
    }
    const og = c.createGain();
    og.gain.value = gain;
    osc.connect(og);
    og.connect(g);
    osc.start(now);
    osc.stop(now + o.dur + 0.02);
    osc.onended = () => {
      try {
        osc.disconnect();
        og.disconnect();
      } catch {
        /* ignore */
      }
    };
  };

  spawnOsc(o.f0, o.type ?? "triangle", 1, o.f1);
  if (o.partials) {
    for (const p of o.partials) {
      spawnOsc(
        o.f0 * p.mult,
        p.type ?? "sine",
        p.gain,
        o.f1 !== undefined ? o.f1 * p.mult : undefined
      );
    }
  }

  if (o.sub) {
    const so = c.createOscillator();
    so.type = o.sub.type ?? "sine";
    so.frequency.setValueAtTime(o.sub.f, now);
    const sg = c.createGain();
    sg.gain.setValueAtTime(0.0001, now);
    sg.gain.linearRampToValueAtTime(o.sub.gain, now + o.a);
    sg.gain.linearRampToValueAtTime(0.0001, now + o.dur);
    so.connect(sg);
    sg.connect(masterGain!);
    so.start(now);
    so.stop(now + o.dur + 0.02);
    so.onended = () => {
      try {
        so.disconnect();
        sg.disconnect();
      } catch {
        /* ignore */
      }
    };
  }

  if (o.noise) {
    const nd = o.noise;
    const n = makeNoise(c, nd.dur);
    const ng = c.createGain();
    ng.gain.setValueAtTime(nd.gain, now + nd.t);
    ng.gain.linearRampToValueAtTime(0.0001, now + nd.t + nd.dur);
    let nn: AudioNode = n;
    let hp: BiquadFilterNode | null = null;
    if (nd.hp) {
      hp = c.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = nd.hp;
      n.connect(hp);
      nn = hp;
    }
    nn.connect(ng);
    ng.connect(masterGain!);
    n.start(now + nd.t);
    n.stop(now + nd.t + nd.dur + 0.02);
    n.onended = () => {
      try {
        n.disconnect();
        ng.disconnect();
        if (hp) hp.disconnect();
      } catch {
        /* ignore */
      }
    };
  }

  const stopMs = (o.dur + 0.1) * 1000;
  window.setTimeout(
    () => {
      try {
        g.disconnect();
        if (lp) lp.disconnect();
      } catch {
        /* ignore */
      }
    },
    stopMs
  );
}

/** Play a synthesized sound event. No-op when muted or audio is unavailable. */
export function play(event: SfxEvent): void {
  if (!active || muted) return;
  const c = getCtx();
  if (!c) return;
  try {
    const t = c.currentTime;
    switch (event) {
      case "place_player":
        blip(c, { type: "triangle", f0: 480, f1: 230, t0: t, dur: 0.13, a: 0.002, d: 0.07, peak: 0.5, lp: 4200, noise: { hp: 2000, gain: 0.15, dur: 0.005, t: 0 } });
        break;
      case "place_ai":
        blip(c, { type: "triangle", f0: 360, f1: 170, t0: t, dur: 0.15, a: 0.002, d: 0.08, peak: 0.42, lp: 3200 });
        break;
      case "victory": {
        const notes = [523, 659, 784, 1046];
        const offs = [0, 0.09, 0.18, 0.28];
        notes.forEach((f, i) =>
          blip(c, { type: "triangle", f0: f, t0: t + offs[i], dur: 0.358, a: 0.008, d: 0.1, peak: 0.4, lp: 6000 })
        );
        blip(c, { type: "sine", f0: 261, t0: t, dur: 0.7, a: 0.01, d: 0.4, peak: 0.3, lp: 2000 });
        blip(c, { type: "triangle", f0: 1568, t0: t + 0.28, dur: 0.4, a: 0.008, d: 0.2, peak: 0.12, lp: 7000 });
        break;
      }
      case "defeat": {
        const notes = [294, 233, 196];
        const offs = [0, 0.14, 0.28];
        notes.forEach((f, i) =>
          blip(c, { type: "triangle", f0: f, t0: t + offs[i], dur: 0.59, a: 0.02, d: 0.18, peak: 0.35, lp: 1800 })
        );
        blip(c, { type: "sine", f0: 110, t0: t, dur: 0.8, a: 0.02, d: 0.5, peak: 0.1, lp: 600 });
        break;
      }
      case "draw": {
        blip(c, { type: "triangle", f0: 587, f1: 440, t0: t, dur: 0.36, a: 0.015, d: 0.14, peak: 0.32, lp: 2600 });
        blip(c, { type: "triangle", f0: 440, t0: t + 0.16, dur: 0.36, a: 0.015, d: 0.14, peak: 0.32, lp: 2600 });
        break;
      }
      case "ui_click":
        blip(c, { type: "triangle", f0: 880, f1: 660, t0: t, dur: 0.06, a: 0.001, d: 0.03, peak: 0.25, lp: 5000, noise: { hp: 2000, gain: 0.08, dur: 0.003, t: 0 } });
        break;
      case "achievement":
        blip(c, {
          type: "triangle", f0: 988, f1: 988 * 1.04, t0: t, dur: 0.6, a: 0.005, d: 0.09, peak: 0.35, lp: 7000,
          partials: [
            { mult: 2.0, gain: 0.12 },
            { mult: 2.76, gain: 0.07 },
          ],
        });
        blip(c, {
          type: "sine", f0: 1319, f1: 1319 * 1.04, t0: t + 0.11, dur: 0.6, a: 0.005, d: 0.09, peak: 0.3, lp: 7000,
          partials: [
            { mult: 2.0, gain: 0.1 },
            { mult: 2.76, gain: 0.06 },
          ],
        });
        break;
      case "hover":
        blip(c, { type: "triangle", f0: 300, t0: t, dur: 0.08, a: 0.005, d: 0.04, peak: 0.05, lp: 1500 });
        break;
      case "thinking_start":
        blip(c, { type: "triangle", f0: 440, f1: 587, t0: t, dur: 0.12, a: 0.005, d: 0.06, peak: 0.11, lp: 3000 });
        break;
      case "thinking_end":
        blip(c, { type: "triangle", f0: 587, f1: 440, t0: t, dur: 0.13, a: 0.005, d: 0.07, peak: 0.11, lp: 3000 });
        break;
      case "undo":
        // triangle 240→180Hz glide; soft lowpassed "step back" thunk.
        blip(c, { type: "triangle", f0: 240, f1: 180, t0: t, dur: 0.14, a: 0.003, d: 0.09, peak: 0.4, lp: 2200 });
        break;
      case "unmute_tick":
        // short confirmation tick when sound returns from muted.
        blip(c, { type: "triangle", f0: 660, f1: 550, t0: t, dur: 0.06, a: 0.001, d: 0.03, peak: 0.12, lp: 5000 });
        break;
    }
  } catch {
    /* audio failures must never break gameplay */
  }
}
