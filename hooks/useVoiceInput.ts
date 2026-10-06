'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceState } from '@/lib/assistant/contract';
import { VOICE_MESSAGES } from '@/lib/assistant/contract';

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition || w.webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | null;
}

function isSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const hasRecorder = typeof MediaRecorder !== 'undefined';
  return hasMedia && hasRecorder;
}

const INITIAL: VoiceState = { status: 'idle', transcript: '' };

/**
 * Голосовий ввід: запис аудіо + попередній перегляд транскрипції.
 * Обробляє відмову доступу до мікрофона і відсутність підтримки браузера.
 */
export function useVoiceInput(onTranscript?: (text: string) => void) {
  const [state, setState] = useState<VoiceState>(INITIAL);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef('');
  const audioUrlRef = useRef<string | null>(null);

  const cleanupAudio = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  useEffect(() => cleanupAudio, [cleanupAudio]);

  const stop = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // Розпізнавач уже зупинено.
    }
    recognitionRef.current = null;
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    } catch {
      setState(prev => ({ ...prev, status: 'error', message: VOICE_MESSAGES.error }));
    }
  }, []);

  const start = useCallback(async () => {
    if (!isSupported()) {
      setState({ status: 'unsupported', transcript: '', message: VOICE_MESSAGES.unsupported });
      return;
    }
    setState({ status: 'requesting', transcript: '' });
    transcriptRef.current = '';
    chunksRef.current = [];

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as { name?: string })?.name || '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setState({ status: 'denied', transcript: '', message: VOICE_MESSAGES.denied });
      } else {
        setState({ status: 'error', transcript: '', message: VOICE_MESSAGES.error });
      }
      return;
    }

    streamRef.current = stream;

    try {
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = e => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        const text = transcriptRef.current.trim();
        setState({
          status: 'ready',
          transcript: text,
          audioUrl: url,
          message: text ? undefined : 'Аудіо записано, але розпізнавання мови недоступне — введіть текст вручну',
        });
        if (text) onTranscript?.(text);
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      };
      recorderRef.current = recorder;
      recorder.start();
    } catch {
      cleanupAudio();
      setState({ status: 'error', transcript: '', message: VOICE_MESSAGES.error });
      return;
    }

    const SR = getSpeechRecognition();
    if (SR) {
      try {
        const recognition = new SR();
        recognition.lang = 'uk-UA';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = event => {
          let text = '';
          for (let i = 0; i < event.results.length; i++) {
            text += event.results[i][0].transcript;
          }
          transcriptRef.current = text;
          setState(prev => ({ ...prev, status: 'recording', transcript: text }));
        };
        recognition.onerror = () => {
          // Помилка розпізнавання не має ламати запис аудіо.
        };
        recognition.onend = () => {};
        recognition.start();
        recognitionRef.current = recognition;
      } catch {
        recognitionRef.current = null;
      }
    }

    setState(prev => ({
      ...prev,
      status: 'recording',
      transcript: '',
      message: recognitionRef.current ? VOICE_MESSAGES.recording : 'Запис… (розпізнавання мови недоступне)',
    }));
  }, [cleanupAudio, onTranscript]);

  const reset = useCallback(() => {
    try { recognitionRef.current?.abort(); } catch { /* ignore */ }
    recognitionRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch { /* ignore */ }
    }
    cleanupAudio();
    transcriptRef.current = '';
    setState(INITIAL);
  }, [cleanupAudio]);

  const supported = isSupported();

  return { state, start, stop, reset, supported };
}
