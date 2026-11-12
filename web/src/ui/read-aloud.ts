/**
 * Read aloud with the browser's own speech (Web Speech API). The text is
 * spoken on the device by the browser or the system, and the app sends
 * nothing anywhere for it (R7.4). Where the browser has no speech, `supported`
 * is false and the screen shows no Listen buttons.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const SPEECH_LANG = "en-GB";
/** A little slower than normal, which is easier to follow. */
const SPEECH_RATE = 0.9;

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

const noopSubscribe = () => () => {};

export interface ReadAloud {
  supported: boolean;
  /** The ID of what is being read now, or null. */
  speakingId: string | null;
  /** Reads `text`. Reads nothing if `id` is already being read, which stops it. */
  toggle: (id: string, text: string) => void;
  stop: () => void;
}

export function useReadAloud(): ReadAloud {
  const supported = useSyncExternalStore(noopSubscribe, isSpeechSupported, () => false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const speakingRef = useRef<string | null>(null);

  const setSpeaking = useCallback((id: string | null) => {
    speakingRef.current = id;
    setSpeakingId(id);
  }, []);

  const stop = useCallback(() => {
    if (!isSpeechSupported()) return;
    window.speechSynthesis.cancel();
    setSpeaking(null);
  }, [setSpeaking]);

  const toggle = useCallback(
    (id: string, text: string) => {
      if (!isSpeechSupported()) return;
      const synth = window.speechSynthesis;
      const wasSpeaking = speakingRef.current === id;
      synth.cancel();
      if (wasSpeaking) {
        setSpeaking(null);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = SPEECH_LANG;
      utterance.rate = SPEECH_RATE;
      // A cancelled utterance ends later than the next one starts, so only clear our own ID.
      const done = () => {
        if (speakingRef.current === id) setSpeaking(null);
      };
      utterance.onend = done;
      utterance.onerror = done;
      setSpeaking(id);
      synth.speak(utterance);
    },
    [setSpeaking],
  );

  // Stop speaking when the screen goes away.
  useEffect(() => {
    return () => {
      if (isSpeechSupported()) window.speechSynthesis.cancel();
    };
  }, []);

  return { supported, speakingId, toggle, stop };
}
