/** Uses the browser's own speech (Web Speech API), so no text leaves the device. */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const SPEECH_LANG = "en-GB";
const SPEECH_RATE = 0.9;

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

const noopSubscribe = () => () => {};

export interface ReadAloud {
  supported: boolean;
  speakingId: string | null;
  /** Stops instead when `id` is already being read. */
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

  useEffect(() => {
    return () => {
      if (isSpeechSupported()) window.speechSynthesis.cancel();
    };
  }, []);

  return { supported, speakingId, toggle, stop };
}
