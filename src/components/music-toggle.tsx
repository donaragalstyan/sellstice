"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "sellstice-music";
// D3, A3, F#4, D5 — a warm, open chord for a slow-moving ambient pad.
const CHORD_HZ = [146.83, 220.0, 369.99, 587.33];
const MASTER_VOLUME = 0.16;

interface PadEngine {
  context: AudioContext;
  master: GainNode;
  oscillators: OscillatorNode[];
}

export function MusicToggle() {
  const [on, setOn] = useState(false);
  const engineRef = useRef<PadEngine | null>(null);

  useEffect(() => {
    try {
      // One-time read of a persisted preference on mount — not syncing an
      // external store on every render, so a single setState here is fine.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOn(localStorage.getItem(STORAGE_KEY) === "on");
    } catch {
      // private browsing / storage disabled — default stays off
    }
  }, []);

  const stopEngine = useCallback(() => {
    const engine = engineRef.current;
    engineRef.current = null;
    if (!engine) return;
    const { context, master, oscillators } = engine;
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0, now + 1.2);
    setTimeout(() => {
      oscillators.forEach((osc) => {
        try {
          osc.stop();
        } catch {
          // already stopped
        }
      });
      context.close().catch(() => {});
    }, 1300);
  }, []);

  // Ambient pad synthesized entirely with the Web Audio API — no audio
  // file, so no licensing to worry about and nothing to fetch.
  const startEngine = useCallback(() => {
    if (engineRef.current) return;
    const context = new AudioContext();

    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    filter.Q.value = 0.5;

    const master = context.createGain();
    master.gain.value = 0;
    filter.connect(master);
    master.connect(context.destination);

    const oscillators = CHORD_HZ.map((freq, i) => {
      const osc = context.createOscillator();
      const isTopVoice = i === CHORD_HZ.length - 1;
      osc.type = isTopVoice ? "triangle" : "sine";
      osc.frequency.value = freq;
      osc.detune.value = (i % 2 === 0 ? -1 : 1) * (3 + i * 2);

      const voiceGain = context.createGain();
      voiceGain.gain.value = isTopVoice ? 0.35 : 0.6;

      osc.connect(voiceGain);
      voiceGain.connect(filter);
      osc.start();
      return osc;
    });

    // A slow LFO breathing on the filter cutoff so the pad drifts gently
    // instead of sitting as a static drone.
    const lfo = context.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoDepth = context.createGain();
    lfoDepth.gain.value = 250;
    lfo.connect(lfoDepth);
    lfoDepth.connect(filter.frequency);
    lfo.start();
    oscillators.push(lfo);

    const now = context.currentTime;
    master.gain.linearRampToValueAtTime(MASTER_VOLUME, now + 2);

    if (context.state === "suspended") {
      const resume = () => {
        context.resume().catch(() => {});
      };
      window.addEventListener("pointerdown", resume, { once: true });
      window.addEventListener("keydown", resume, { once: true });
    }

    engineRef.current = { context, master, oscillators };
  }, []);

  useEffect(() => {
    if (on) {
      startEngine();
    } else {
      stopEngine();
    }
    try {
      localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
    } catch {
      // ignore
    }
  }, [on, startEngine, stopEngine]);

  useEffect(() => stopEngine, [stopEngine]);

  return (
    <button
      type="button"
      onClick={() => setOn((prev) => !prev)}
      aria-pressed={on}
      aria-label={on ? "Turn off ambient music" : "Turn on ambient music"}
      title={on ? "Turn off ambient music" : "Turn on ambient music"}
      className="fixed right-4 bottom-4 z-50 flex h-11 w-11 items-center justify-center rounded-full border shadow-lg backdrop-blur transition-transform hover:-translate-y-0.5"
      style={{
        borderColor: "var(--color-border)",
        backgroundImage: on ? "var(--gradient-solstice)" : undefined,
        backgroundColor: on ? undefined : "var(--color-surface)",
        color: on ? "#fff" : "var(--color-muted)",
      }}
    >
      <MusicIcon muted={!on} />
    </button>
  );
}

function MusicIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 18V5l12-2v13"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="1.8" />
      {muted && (
        <path
          d="M3 3l18 18"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
