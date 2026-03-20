import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, storage } from '../lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { 
  collection, addDoc, getDocs, updateDoc, doc, getDoc, 
  query, where, limit, orderBy, serverTimestamp 
} from 'firebase/firestore';
import { useAuth } from '../context/useAuth';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { 
  Mic, MicOff, RotateCcw, Loader2, Send, 
  ChevronLeft, ClipboardList, Clock, Info, CheckCircle2, AlertCircle,
  Paperclip, CheckCircle, FileText
} from 'lucide-react';

import Layout from '../components/Layout';
import useSpeechToText from '../hooks/useSpeechToText';
import { createReportData, createApunteData, REPORT_STATUSES } from '../utils/reportSchema';

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

export default function ProfessionalFieldReport() {
  const { calendarEventId } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { 
    isRecording, transcript, interimTranscript, 
    startRecording, stopRecording, clearTranscript, 
    isSupported, micError 
  } = useSpeechToText();

  const [loading, setLoading] = useState(true);
  const [saving, setLoadingSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  const [calendarEvent, setCalendarEvent] = useState(null);
  const [report, setReport] = useState(null);
  const [apuntes, setApuntes] = useState([]);
  const [observaciones, setObservaciones] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  // 1. Fetch Calendar Event Data
  const fetchCalendarEvent = async () => {
    try {
      const docRef = doc(db, 'calendar_events', calendarEventId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setCalendarEvent(docSnap.data());
      } else {
        toast.error('Evento no encontrado.');
        navigate('/mis-tareas');
      }
    } catch (err) {
      console.error(err);
      toast.error('Error al cargar datos del evento.');
    }
  };

  // 2. Load Existing Report and Apuntes
  const fetchReportData = async () => {
    try {
      const qReport = query(
        collection(db, 'reports'), 
        where('calendarEventId', '==', calendarEventId), 
        limit(1)
      );
      const rSnap = await getDocs(qReport);
      
      if (!rSnap.empty) {
        const reportDoc = { id: rSnap.docs[0].id, ...rSnap.docs[0].data() };
        setReport(reportDoc);
        
        // Load apuntes
        const qApuntes = query(
          collection(db, 'reports', reportDoc.id, 'apuntes'),
          orderBy('createdAt', 'asc')
        );
        const aSnap = await getDocs(qApuntes);
        setApuntes(aSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      }
    } catch (err) {
      console.error('Error fetching report:', err);
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await fetchCalendarEvent();
      await fetchReportData();
      setLoading(false);
    };
    init();
  }, [calendarEventId]);

  // Sync transcript to textarea when recording stops
  useEffect(() => {
    if (!isRecording && transcript) {
      setObservaciones(prev => {
        const trimmed = prev.trim();
        return trimmed ? `${trimmed}\n${transcript}` : transcript;
      });
    }
  }, [isRecording]);

  // Handle Note Save
  const handleSaveApunte = async () => {
    if (!observaciones.trim()) return;
    setLoadingSaving(true);

    try {
      let currentReportId = report?.id;

      // Create main report doc if it doesn't exist
      if (!currentReportId) {
        const reportData = createReportData({
          projectId: calendarEvent.projectId,
          projectName: calendarEvent.projectName,
          projectCode: calendarEvent.projectCode || '',
          calendarEventId: calendarEventId,
          authorId: currentUser.uid,
          authorName: currentUser.displayName,
          recurrence: calendarEvent.recurrence || ''
        });
        
        const rRef = await addDoc(collection(db, 'reports'), {
          ...reportData,
          createdAt: serverTimestamp()
        });
        currentReportId = rRef.id;
        setReport({ id: rRef.id, ...reportData });
      }

      // Add apunte subcollection doc
      const apunteData = createApunteData({
        authorId: currentUser.uid,
        authorName: currentUser.displayName,
        content: observaciones.trim()
      });

      await addDoc(collection(db, 'reports', currentReportId, 'apuntes'), {
        ...apunteData,
        createdAt: serverTimestamp()
      });

      toast.success('Apunte guardado.');
      setObservaciones('');
      clearTranscript();
      await fetchReportData();
    } catch (err) {
      console.error(err);
      toast.error('Error al guardar apunte.');
    } finally {
      setLoadingSaving(false);
    }
  };

  // Handle Final Submission
  const handleSubmitReport = async () => {
    if (!report || apuntes.length === 0) return;
    if (report.status !== REPORT_STATUSES.DRAFT) return;

    if (!window.confirm("¿Estás seguro? Una vez enviado no podrás agregar más apuntes.")) {
      return;
    }

    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'reports', report.id), {
        status: REPORT_STATUSES.SUBMITTED,
        submittedAt: serverTimestamp()
      });
      toast.success("Informe enviado. Andrés revisará tu reporte.");
      navigate('/mis-tareas');
    } catch (err) {
      console.error(err);
      toast.error('Error al enviar informe.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUploadPDF = async () => {
    if (!file || !report) return;
    setUploading(true);

    try {
      const storageRef = ref(storage, `report-attachments/${report.id}/${file.name}`);
      const snapshot = await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(snapshot.ref);

      await updateDoc(doc(db, 'reports', report.id), {
        attachmentURL: downloadURL,
        attachmentName: file.name,
        updatedAt: serverTimestamp()
      });

      toast.success("Informe adjuntado correctamente.");
      setFile(null);
      await fetchReportData();
    } catch (err) {
      console.error(err);
      toast.error("Error al subir el archivo.");
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <Layout title="Informe de Terreno">
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      </Layout>
    );
  }

  // Format Date for Header
  const dateRange = calendarEvent ? (() => {
    const startFmt = capitalize(format(parseISO(calendarEvent.startDate), 'EEE d', { locale: es }));
    const endFmt = capitalize(format(parseISO(calendarEvent.endDate), "EEE d 'de' MMMM", { locale: es }));
    return `${startFmt} — ${endFmt}`;
  })() : '';

  const isReadOnly = report && report.status !== REPORT_STATUSES.DRAFT;

  return (
    <Layout title="Informe de Terreno">
      <div className="max-w-xl mx-auto space-y-6 pb-20">
        
        {/* Status Banners */}
        {report && report.status === REPORT_STATUSES.SUBMITTED && (
          <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-4 flex items-center gap-3 text-indigo-300">
            <Clock className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm font-medium">Informe enviado. Pendiente de revisión.</p>
          </div>
        )}
        {report && report.status === REPORT_STATUSES.IN_PROGRESS && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-center gap-3 text-amber-300">
            <Info className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm font-medium">Informe en confección. Asignado a {report.assignedToName}.</p>
          </div>
        )}
        {report && report.status === REPORT_STATUSES.APPROVED && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-center gap-3 text-emerald-300">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm font-medium">Informe aprobado. ✓</p>
          </div>
        )}
        {report && report.status === REPORT_STATUSES.REJECTED && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center gap-3 text-red-300">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">Informe rechazado.</p>
              {report.reviewComment && <p className="text-xs mt-1 opacity-80">Motivo: {report.reviewComment}</p>}
            </div>
          </div>
        )}

        {/* Header Card */}
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 shadow-lg space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-white font-bold text-lg leading-tight">
                {calendarEvent?.projectName}
              </h2>
              <div className="flex items-center gap-2 mt-1.5">
                {calendarEvent?.projectCode && (
                  <span className="font-mono text-indigo-400 bg-indigo-500/10 px-1.5 rounded text-xs font-bold">
                    {calendarEvent.projectCode}
                  </span>
                )}
                {calendarEvent?.recurrence && (
                  <span className="text-slate-400 text-xs px-1.5 border border-slate-700 rounded capitalize">
                    {calendarEvent.recurrence}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="bg-slate-900/50 rounded-xl p-4 space-y-2.5 text-sm">
            <div className="flex items-start gap-2">
              <span className="text-slate-500 w-20 shrink-0">Período</span>
              <span className="text-slate-200">{dateRange}</span>
            </div>
            {calendarEvent?.ingenierosNames?.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="text-slate-500 w-20 shrink-0">Equipo</span>
                <span className="text-slate-200">{calendarEvent.ingenierosNames.join(', ')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Apuntes List */}
        <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden shadow-lg">
          <div className="px-5 py-4 border-b border-slate-700 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-indigo-400" />
            <h3 className="text-white font-semibold">Apuntes del Terreno</h3>
          </div>
          <div className="p-5 space-y-4 max-h-[400px] overflow-y-auto">
            {apuntes.length === 0 ? (
              <p className="text-slate-500 text-center py-4 text-sm italic">
                No hay apuntes registrados aún.
              </p>
            ) : (
              apuntes.map((apunte, i) => (
                <div key={apunte.id} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400">{apunte.authorName}</span>
                    <span className="text-[10px] text-slate-500">
                      {apunte.createdAt?.toDate ? format(apunte.createdAt.toDate(), "d MMM HH:mm", { locale: es }) : '...'}
                    </span>
                  </div>
                  <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                    {apunte.content}
                  </p>
                  {i < apuntes.length - 1 && <div className="pt-4 border-b border-slate-700/50" />}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recording / Input Section */}
        {!isReadOnly && (
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 shadow-2xl space-y-6">
            <div className="flex flex-col items-center gap-4">
              <div className="relative flex items-center justify-center">
                {isRecording && (
                  <>
                    <span className="absolute inset-0 rounded-full bg-indigo-500/30 animate-ping" />
                    <span className="absolute inset-[-8px] rounded-full border-2 border-indigo-400/40 animate-pulse" />
                  </>
                )}
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  style={{ width: 80, height: 80 }}
                  className={[
                    'relative rounded-full flex items-center justify-center transition-all shadow-lg',
                    isRecording 
                      ? 'bg-indigo-500 hover:bg-indigo-600 shadow-indigo-500/40' 
                      : 'bg-slate-700 hover:bg-slate-600'
                  ].join(' ')}
                >
                  {isRecording ? <MicOff className="w-8 h-8 text-white" /> : <Mic className="w-8 h-8 text-slate-200" />}
                </button>
              </div>
              <p className="text-xs text-slate-400 font-medium">
                {isRecording ? 'Grabando... (toca para detener)' : 'Pulsa para grabar apunte por voz'}
              </p>
              
              {!isSupported && (
                <p className="text-[10px] text-amber-400 text-center">
                  Tu navegador no soporta dictado por voz.
                </p>
              )}
              {micError && (
                <p className="text-[10px] text-red-400 text-center max-w-[200px]">
                  {micError}
                </p>
              )}
            </div>

            {/* Live Visualizer Area if recording */}
            {(isRecording || interimTranscript || transcript) && (
              <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-3 min-h-[4rem]">
                <p className="text-sm text-slate-400 leading-relaxed italic">
                  {transcript}
                  {interimTranscript && <span className="text-slate-600">{interimTranscript}</span>}
                </p>
              </div>
            )}

            <div className="space-y-3">
              <textarea
                value={observaciones}
                onChange={e => setObservaciones(e.target.value)}
                placeholder="O escribe tu apunte manualmente aquí..."
                rows={4}
                className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 text-sm placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none"
              />
              
              <div className="flex gap-2">
                <button
                  onClick={() => { setObservaciones(''); clearTranscript(); }}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Limpiar
                </button>
                <button
                  onClick={handleSaveApunte}
                  disabled={!observaciones.trim() || saving}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 transition-all"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Guardar Apunte
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PDF Upload Section (for assigned writer when in_progress) */}
        {report && report.status === REPORT_STATUSES.IN_PROGRESS && report.assignedToId === currentUser.uid && (
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-5 h-5 text-indigo-400" />
              <h3 className="text-white font-semibold text-sm">Cargar Informe Final (PDF)</h3>
            </div>

            {report.attachmentURL && (
              <div className="flex items-center gap-2 text-emerald-400 bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <a 
                  href={report.attachmentURL} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-xs font-bold hover:underline truncate"
                >
                  Informe adjunto: {report.attachmentName}
                </a>
              </div>
            )}

            <div className="space-y-3">
              <div className="relative group">
                <input 
                  type="file" 
                  accept=".pdf"
                  onChange={e => setFile(e.target.files[0])}
                  className="hidden" 
                  id="pdf-upload"
                />
                <label 
                  htmlFor="pdf-upload"
                  className="w-full flex items-center justify-between px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl cursor-pointer hover:border-indigo-500 transition-colors"
                >
                  <span className="text-sm text-slate-400">
                    {file ? file.name : "Seleccionar archivo PDF..."}
                  </span>
                  <Paperclip className="w-4 h-4 text-slate-500 group-hover:text-indigo-400" />
                </label>
              </div>

              <button
                onClick={handleUploadPDF}
                disabled={!file || uploading}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-500/20"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Subir informe
              </button>
            </div>
          </div>
        )}

        {/* Global Action */}
        {!isReadOnly && (
          <div className="pt-4">
            <button
              onClick={handleSubmitReport}
              disabled={apuntes.length === 0 || submitting}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-2xl text-base font-black flex items-center justify-center gap-2 shadow-xl shadow-emerald-900/20 transition-all"
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
              ENVIAR INFORME FINAL
            </button>
            <p className="text-center text-[10px] text-slate-500 mt-3 px-10">
              Una vez enviado, el equipo de revisión procesará el informe. Ya no podrás agregar más notas.
            </p>
          </div>
        )}

      </div>
    </Layout>
  );
}
