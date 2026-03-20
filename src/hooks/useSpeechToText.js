import { useState, useEffect, useRef } from 'react';

/**
 * Custom hook for Web Speech API with Chilean Spanish support.
 * Wraps the SpeechRecognition interface to provide recording states and transcripts.
 */
export default function useSpeechToText() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [micError, setMicError] = useState('');
  const [isSupported, setIsSupported] = useState(false);

  const recognitionRef = useRef(null);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }

    setIsSupported(true);

    const recognition = new SpeechRecognition();
    recognition.lang = 'es-CL';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let finalPart = '';
      let interimPart = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalPart += event.results[i][0].transcript;
        } else {
          interimPart += event.results[i][0].transcript;
        }
      }

      if (finalPart) {
        setTranscript(prev => {
          const trimmed = prev.trimEnd();
          return trimmed ? `${trimmed} ${finalPart}` : finalPart;
        });
      }
      setInterimTranscript(interimPart);
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'permission-denied') {
        setMicError(
          'Permiso de micrófono denegado. Ve a la configuración de tu navegador, ' +
          'permite el acceso al micrófono para este sitio e intenta nuevamente.'
        );
      } else if (event.error === 'no-speech') {
        // Ignored - common when user stops talking
      } else {
        setMicError(`Error de reconocimiento de voz: ${event.error}`);
      }
      setIsRecording(false);
      setInterimTranscript('');
    };

    recognition.onend = () => {
      setIsRecording(false);
      setInterimTranscript('');
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.abort();
    };
  }, []);

  const startRecording = () => {
    setMicError('');
    setInterimTranscript('');
    try {
      recognitionRef.current?.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Speech recognition start error:', err);
      setMicError('No se pudo iniciar el reconocimiento. Intenta nuevamente.');
    }
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
  };

  const clearTranscript = () => {
    recognitionRef.current?.abort();
    setIsRecording(false);
    setInterimTranscript('');
    setTranscript('');
  };

  return {
    isRecording,
    transcript,
    interimTranscript,
    startRecording,
    stopRecording,
    clearTranscript,
    isSupported,
    micError
  };
}
