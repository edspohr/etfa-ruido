import { useState, useEffect, useRef } from 'react';
import { db } from '../lib/firebase';
import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Mic, MicOff, X, RotateCcw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/useAuth';
import { generateReporteTecnicoTask } from '../utils/taskAutoGeneration';

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

export default function FieldClosureModal({ isOpen, onClose, calendarEvent, onClosed }) {
  const { currentUser, userRole } = useAuth();

  const [isRecording,       setIsRecording]       = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [observaciones,     setObservaciones]     = useState('');
  const [micError,          setMicError]          = useState('');
  const [confirming,        setConfirming]        = useState(false);
  const [speechSupported,   setSpeechSupported]   = useState(false);

  const recognitionRef  = useRef(null);
  const liveDisplayRef  = useRef(null);

  // ── Initialize Web Speech API once on mount ──────────────────────────────

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }

    setSpeechSupported(true);

    const recognition = new SpeechRecognition();
    recognition.lang           = 'es-CL';
    recognition.continuous     = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let finalPart   = '';
      let interimPart = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalPart += event.results[i][0].transcript;
        } else {
          interimPart += event.results[i][0].transcript;
        }
      }

      if (finalPart) {
        // Append finalized words to the textarea value
        setObservaciones(prev => {
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
        // Silence is not an error — ignore
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

  // ── Reset state when modal opens / cleans up when it closes ──────────────

  useEffect(() => {
    if (isOpen) {
      setObservaciones('');
      setInterimTranscript('');
      setMicError('');
      setConfirming(false);
    } else {
      recognitionRef.current?.abort();
      setIsRecording(false);
      setInterimTranscript('');
    }
  }, [isOpen]);

  // ── Auto-scroll live display as text grows ────────────────────────────────

  useEffect(() => {
    if (liveDisplayRef.current) {
      liveDisplayRef.current.scrollTop = liveDisplayRef.current.scrollHeight;
    }
  }, [observaciones, interimTranscript]);

  // ── Mic toggle ────────────────────────────────────────────────────────────

  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop(); // processes pending results before ending
    } else {
      setMicError('');
      setInterimTranscript('');
      try {
        recognitionRef.current?.start();
        setIsRecording(true);
      } catch (err) {
        console.error('Speech recognition start error:', err);
        setMicError('No se pudo iniciar el reconocimiento. Intenta nuevamente.');
      }
    }
  };

  const clearTranscript = () => {
    recognitionRef.current?.abort();
    setIsRecording(false);
    setInterimTranscript('');
    setObservaciones('');
  };

  // ── Confirm closure ───────────────────────────────────────────────────────

  const handleConfirm = async () => {
    if (isRecording || confirming || !calendarEvent) return;

    setConfirming(true);
    try {
      // 1. Write closure note to project bitácora
      await addDoc(
        collection(db, 'projects', calendarEvent.projectId, 'logs'),
        {
          type:      'field_closure',
          content:   observaciones.trim(),
          userName:  currentUser?.displayName || 'Admin',
          userRole:  userRole || 'admin',
          timestamp: serverTimestamp(),
        }
      );

      // 2. Mark calendar event as closed
      await updateDoc(doc(db, 'calendar_events', calendarEvent.id), {
        status:   'closed',
        closedAt: serverTimestamp(),
      });

      // 3. Auto-generate Reporte Técnico task (only if Flash was not selected at event creation)
      if (!calendarEvent.includeFlash) {
        await generateReporteTecnicoTask(calendarEvent, db);
      }

      // 4. Notify
      const closureMsg = calendarEvent.includeFlash
        ? 'Terreno cerrado.'
        : 'Terreno cerrado. Reporte Técnico generado automáticamente.'
      toast.success(closureMsg);

      // 5. Callbacks
      onClosed();
      onClose();
    } catch (err) {
      console.error('Error al cerrar terreno:', err);
      toast.error('Error al cerrar el terreno. Intenta nuevamente.');
    } finally {
      setConfirming(false);
    }
  };

  // ── Guard ─────────────────────────────────────────────────────────────────

  if (!isOpen || !calendarEvent) return null;

  // ── Format date range ─────────────────────────────────────────────────────

  const startFmt  = capitalize(format(parseISO(calendarEvent.startDate), 'EEE d',           { locale: es }));
  const endFmt    = capitalize(format(parseISO(calendarEvent.endDate),   "EEE d 'de' MMMM", { locale: es }));
  const dateRange = `${startFmt} – ${endFmt}`;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg shadow-2xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">

        {/* ── Header ── */}
        <div className="sticky top-0 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-5 py-4 z-10">
          <div>
            <h2 className="text-white font-bold text-lg leading-tight">Cierre de Terreno</h2>
            <p className="text-slate-400 text-xs mt-0.5 truncate max-w-xs">{calendarEvent.projectName}</p>
          </div>
          <button
            onClick={onClose}
            disabled={confirming}
            className="text-slate-400 hover:text-white transition-colors p-1 disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">

          {/* ── Section 1: Event summary ── */}
          <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-4 space-y-2.5 text-sm">
            <div className="flex items-start gap-2">
              <span className="text-slate-500 w-20 shrink-0">Proyecto</span>
              <span className="text-slate-100 font-semibold">
                {calendarEvent.projectCode && (
                  <span className="font-mono text-indigo-400 mr-1.5">[{calendarEvent.projectCode}]</span>
                )}
                {calendarEvent.projectName}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-slate-500 w-20 shrink-0">Período</span>
              <span className="text-slate-200">{dateRange}</span>
            </div>
            {calendarEvent.ingenierosNames?.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="text-slate-500 w-20 shrink-0">Equipo</span>
                <span className="text-slate-200">{calendarEvent.ingenierosNames.join(', ')}</span>
              </div>
            )}
            {(calendarEvent.vehiculo || calendarEvent.equipamiento) && (
              <div className="flex items-start gap-2">
                <span className="text-slate-500 w-20 shrink-0">Equipos</span>
                <span className="text-slate-200">
                  {[calendarEvent.vehiculo, calendarEvent.equipamiento].filter(Boolean).join(' · ')}
                </span>
              </div>
            )}
          </div>

          {/* ── Section 2: Voice dictation ── */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-300">Transcripción de voz</h3>

            {!speechSupported ? (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-sm text-amber-300">
                Tu navegador no soporta dictado por voz. Escribe las observaciones manualmente.
              </div>
            ) : (
              <>
                {/* Live transcript display */}
                <div
                  ref={liveDisplayRef}
                  className="h-28 overflow-y-auto bg-slate-900/50 border border-slate-700 rounded-xl p-3 text-sm"
                >
                  {!observaciones && !interimTranscript ? (
                    <p className="text-slate-600 italic select-none">
                      El texto aparecerá aquí mientras hablas...
                    </p>
                  ) : (
                    <>
                      <span className="text-slate-200">{observaciones}</span>
                      {interimTranscript && (
                        <span className="text-slate-500 italic"> {interimTranscript}</span>
                      )}
                    </>
                  )}
                </div>

                {/* Mic button + label */}
                <div className="flex flex-col items-center gap-2.5">
                  <div className="relative flex items-center justify-center">
                    {isRecording && (
                      <>
                        <span className="absolute inset-0 rounded-full bg-indigo-500/30 animate-ping" />
                        <span className="absolute inset-[-8px] rounded-full border-2 border-indigo-400/40 animate-pulse" />
                      </>
                    )}
                    <button
                      type="button"
                      onClick={toggleRecording}
                      style={{ width: 80, height: 80 }}
                      className={[
                        'relative rounded-full flex items-center justify-center transition-all shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-800',
                        isRecording
                          ? 'bg-indigo-500 hover:bg-indigo-600 shadow-indigo-500/40'
                          : 'bg-slate-700 hover:bg-slate-600',
                      ].join(' ')}
                    >
                      {isRecording
                        ? <MicOff className="w-8 h-8 text-white" />
                        : <Mic    className="w-8 h-8 text-slate-200" />
                      }
                    </button>
                  </div>

                  <p className="text-xs text-slate-400 text-center select-none">
                    {isRecording ? 'Grabando... (toca para detener)' : 'Iniciar dictado'}
                  </p>

                  {/* Clear */}
                  {(observaciones || interimTranscript) && (
                    <button
                      type="button"
                      onClick={clearTranscript}
                      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Limpiar
                    </button>
                  )}
                </div>

                {/* Mic error */}
                {micError && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-xs text-red-300 leading-relaxed">
                    {micError}
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Section 3: Editable textarea ── */}
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-slate-300">
              Observaciones de cierre
            </label>
            <textarea
              value={observaciones}
              onChange={e => setObservaciones(e.target.value)}
              maxLength={1000}
              rows={4}
              placeholder="Describe el trabajo realizado, condiciones del sitio, incidencias..."
              className="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-xl text-slate-100 text-sm placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
            />
            <div className="flex justify-between items-center">
              <p className="text-xs text-slate-500">
                Este texto quedará registrado en la bitácora del proyecto.
              </p>
              <span className="text-xs text-slate-600 tabular-nums">{observaciones.length}/1000</span>
            </div>
          </div>

          {/* ── Section 4: Actions ── */}
          <div className="space-y-2.5 pt-1 pb-2">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isRecording || confirming}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
            >
              {confirming ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Procesando...
                </>
              ) : isRecording ? (
                'Detén la grabación para confirmar'
              ) : (
                'Confirmar Cierre de Terreno'
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              disabled={confirming}
              className="w-full py-2.5 px-4 text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
