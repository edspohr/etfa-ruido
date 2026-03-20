import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  collection, getDocs, addDoc, query, 
  where, serverTimestamp 
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../context/useAuth';
import Layout from '../components/Layout';
import SearchableSelect from '../components/SearchableSelect';
import { sortProjects } from '../utils/sort';
import useSpeechToText from '../hooks/useSpeechToText';
import { REPORT_STATUSES } from '../utils/reportSchema';
import { toast } from 'sonner';
import { 
  Mic, MicOff, Trash2, Send, Save, 
  ArrowLeft, ArrowRight, ClipboardList,
  FileText, CheckCircle
} from 'lucide-react';

export default function NewReportManual() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  
  // Step 1: Project Selection
  // Step 2: Content (Voice/Text)
  const [step, setStep] = useState(1);
  
  // State
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Speech to Text
  const {
    isRecording,
    transcript,
    interimTranscript,
    startRecording,
    stopRecording,
    isSupported,
    micError
  } = useSpeechToText();

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const q = query(
          collection(db, 'projects'), 
          where('status', '!=', 'deleted')
        );
        const snap = await getDocs(q);
        const pData = snap.docs.map(d => ({
          id: d.id,
          label: `${d.data().code ? `[${d.data().code}] ` : ''}${d.data().name}`,
          value: d.id,
          ...d.data()
        }));
        setProjects(sortProjects(pData));
      } catch (err) {
        console.error(err);
        toast.error("Error al cargar proyectos.");
      } finally {
        setLoading(false);
      }
    };
    fetchProjects();
  }, []);

  // Update notes when transcript changes
  useEffect(() => {
    if (transcript) {
      setNotes(prev => {
        const trimmed = prev.trimEnd();
        return trimmed ? `${trimmed}\n${transcript}` : transcript;
      });
      // Clear transcript so we don't append it again
      // The hook handles the transcript state, but for "manual" mode 
      // we might want to append it to a persistent state.
    }
  }, [transcript]);

  const handleNext = () => {
    if (!selectedProjectId) {
      toast.error("Selecciona un proyecto para continuar.");
      return;
    }
    setStep(2);
  };

  const handleSubmit = async (isFinal = false) => {
    if (!notes.trim()) {
      toast.error("Escribe o dicta algún apunte antes de guardar.");
      return;
    }

    setIsSubmitting(true);
    try {
      const project = projects.find(p => p.id === selectedProjectId);
      
      // Create the main report doc
      const reportRef = await addDoc(collection(db, 'reports'), {
        projectId: project.id,
        projectName: project.name,
        projectCode: project.code || null,
        recurrence: project.recurrence || null,
        authorId: currentUser.uid,
        authorName: currentUser.displayName || currentUser.email,
        assignedToId: currentUser.uid,
        assignedToName: currentUser.displayName || currentUser.email,
        status: isFinal ? REPORT_STATUSES.SUBMITTED : REPORT_STATUSES.DRAFT,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Add the initial notes as an "apunte" sub-collection item
      await addDoc(collection(db, 'reports', reportRef.id, 'apuntes'), {
        content: notes.trim(),
        authorId: currentUser.uid,
        authorName: currentUser.displayName || currentUser.email,
        createdAt: serverTimestamp(),
      });

      toast.success(isFinal ? "Informe enviado correctamente." : "Borrador guardado.");
      navigate('/dashboard/reports'); // Or wherever appropriate
    } catch (err) {
      console.error(err);
      toast.error("Error al guardar el informe.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) return <Layout title="Nuevo Informe">Cargando...</Layout>;

  return (
    <Layout title="Nuevo Informe Manual">
      <div className="max-w-2xl mx-auto">
        
        {/* Progress Header */}
        <div className="flex items-center justify-center gap-4 mb-8">
          <div className={`flex items-center gap-2 ${step >= 1 ? 'text-indigo-600' : 'text-slate-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold border-2 ${step >= 1 ? 'border-indigo-600 bg-indigo-50' : 'border-slate-300'}`}>1</div>
            <span className="text-sm font-bold">Proyecto</span>
          </div>
          <div className={`w-12 h-0.5 ${step >= 2 ? 'bg-indigo-600' : 'bg-slate-200'}`} />
          <div className={`flex items-center gap-2 ${step >= 2 ? 'text-indigo-600' : 'text-slate-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold border-2 ${step >= 2 ? 'border-indigo-600 bg-indigo-50' : 'border-slate-300'}`}>2</div>
            <span className="text-sm font-bold">Contenido</span>
          </div>
        </div>

        {step === 1 ? (
          <div className="bg-white p-8 rounded-2xl shadow-soft border border-slate-100 space-y-6">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto text-indigo-600">
                <ClipboardList className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-bold text-slate-800">Seleccionar Proyecto</h2>
              <p className="text-slate-500 text-sm">Elige el proyecto para el cual deseas generar este informe manual.</p>
            </div>

            <div className="space-y-4">
              <label className="block text-sm font-bold text-slate-700">Proyecto</label>
              <SearchableSelect
                options={projects}
                value={selectedProjectId}
                onChange={setSelectedProjectId}
                placeholder="Busca por código o nombre..."
              />
            </div>

            <div className="pt-4">
              <button
                onClick={handleNext}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 group"
              >
                Continuar a contenido
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white p-8 rounded-2xl shadow-soft border border-slate-100 space-y-6">
            <div className="flex items-center justify-between">
              <button 
                onClick={() => setStep(1)}
                className="text-slate-400 hover:text-slate-600 flex items-center gap-1.5 text-sm font-bold transition-colors"
                disabled={isRecording}
              >
                <ArrowLeft className="w-4 h-4" />
                Volver
              </button>
              <div className="text-right">
                <p className="text-xs font-bold text-indigo-600 uppercase tracking-widest">Proyecto</p>
                <p className="text-sm font-bold text-slate-800 truncate max-w-[200px]">
                  {projects.find(p => p.id === selectedProjectId)?.name}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-bold text-slate-700 flex justify-between">
                Apuntes del Informe
                <span className={`text-[10px] font-black uppercase tracking-tighter ${notes.length > 0 ? 'text-indigo-500' : 'text-slate-300'}`}>
                  {notes.length} caracteres
                </span>
              </label>
              <div className="relative">
                <textarea
                  className="w-full h-64 p-5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none resize-none leading-relaxed transition-all"
                  placeholder="Comienza a escribir o usa el dictado por voz..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
                
                {interimTranscript && (
                  <div className="absolute bottom-4 left-5 right-5 bg-white/90 backdrop-blur-sm p-3 rounded-xl border border-indigo-100 shadow-sm animate-pulse">
                    <p className="text-xs text-indigo-400 italic font-medium">{interimTranscript}...</p>
                  </div>
                )}
              </div>
            </div>

            {/* Mic Controls */}
            <div className="flex flex-col items-center gap-4">
              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                className={`
                  w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg
                  ${isRecording 
                    ? 'bg-rose-500 hover:bg-rose-600 ring-4 ring-rose-100 animate-pulse' 
                    : 'bg-indigo-600 hover:bg-indigo-700 hover:scale-110 active:scale-95'}
                `}
                title={isRecording ? 'Detener dictado' : 'Iniciar dictado por voz'}
              >
                {isRecording ? <MicOff className="w-6 h-6 text-white" /> : <Mic className="w-6 h-6 text-white" />}
              </button>
              
              <div className="text-center">
                <p className={`text-sm font-bold ${isRecording ? 'text-rose-500' : 'text-slate-500'}`}>
                  {isRecording ? 'Escuchando...' : 'Haz clic para dictar'}
                </p>
                {micError && <p className="text-xs text-rose-500 mt-1 font-medium">{micError}</p>}
                {!isSupported && <p className="text-xs text-slate-400 mt-1">Dictado no soportado en este navegador.</p>}
              </div>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-2 gap-4 pt-6 border-t border-slate-100">
              <button
                onClick={() => handleSubmit(false)}
                disabled={isSubmitting || isRecording}
                className="py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2"
              >
                <Save className="w-4 h-4" />
                Guardar Borrador
              </button>
              <button
                onClick={() => handleSubmit(true)}
                disabled={isSubmitting || isRecording}
                className="py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                Enviar a Revisión
              </button>
            </div>
            
            <button
               onClick={() => { if(window.confirm('¿Limpiar todos los apuntes?')) setNotes(''); }}
               className="w-full py-2 text-[10px] font-black uppercase tracking-widest text-slate-300 hover:text-rose-400 transition-colors"
            >
               Limpiar Apuntes
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}
