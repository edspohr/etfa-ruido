import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import EmptyState from '../components/EmptyState';
import { db } from '../lib/firebase';
import { collection, getDocs, updateDoc, doc, query, where, serverTimestamp } from 'firebase/firestore';
import { format, parseISO, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { ClipboardList, ChevronDown, ChevronUp, Save, Loader2, FileText } from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { toast } from 'sonner';

// NOTE: This query uses `assignedTo` (array-contains). If combined with a status filter in the future,
// a composite Firestore index will be required. Currently only a single array-contains query is used.

const STATUS_OPTIONS = [
  { value: 'pendiente',   label: 'Pendiente' },
  { value: 'en_progreso', label: 'En Progreso' },
  { value: 'completado',  label: 'Completado' },
];

const STATUS_SECTIONS = [
  {
    id:     'pendiente',
    label:  'Pendiente',
    color:  'text-amber-400',
    border: 'border-l-amber-500',
    ring:   'bg-amber-500/10',
  },
  {
    id:     'en_progreso',
    label:  'En Progreso',
    color:  'text-indigo-400',
    border: 'border-l-indigo-500',
    ring:   'bg-indigo-500/10',
  },
  {
    id:     'completado',
    label:  'Completado',
    color:  'text-emerald-400',
    border: 'border-l-emerald-500',
    ring:   'bg-emerald-500/10',
  },
];

const TYPE_CONFIG = {
  reporte_tecnico: {
    label:     'Rep. Técnico',
    badgeClass: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
  },
  reporte_flash: {
    label:     'Rep. Flash',
    badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  },
  informe: {
    label:     'Informe',
    badgeClass: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  },
};

function getDueDateColor(dueDate) {
  if (!dueDate) return 'text-slate-500';
  const todayStr   = format(new Date(), 'yyyy-MM-dd');
  const in2DaysStr = format(addDays(new Date(), 2), 'yyyy-MM-dd');
  if (dueDate < todayStr)    return 'text-red-400';
  if (dueDate <= in2DaysStr) return 'text-amber-400';
  return 'text-slate-500';
}

// ── TaskRow ───────────────────────────────────────────────────────────────────

function TaskRow({ task, onStatusChange }) {
  const navigate = useNavigate();
  const [expanded,    setExpanded]    = useState(false);
  const [noteInput,   setNoteInput]   = useState('');
  const [savingNote,  setSavingNote]  = useState(false);
  const [localStatus, setLocalStatus] = useState(task.status);

  const typeCfg = TYPE_CONFIG[task.type] || { label: task.type || 'Tarea', badgeClass: 'bg-slate-500/20 text-slate-400 border-slate-500/30' };
  const dueDateColor = getDueDateColor(task.dueDate);

  const handleStatusChange = async (newStatus) => {
    const prev = localStatus;
    setLocalStatus(newStatus);
    try {
      await updateDoc(doc(db, 'tasks', task.id), {
        status:      newStatus,
        completedAt: newStatus === 'completado' ? serverTimestamp() : null,
      });
      onStatusChange(task.id, newStatus);
    } catch (err) {
      console.error(err);
      setLocalStatus(prev);
      toast.error('Error al actualizar el estado.');
    }
  };

  const handleSaveNote = async () => {
    if (!noteInput.trim()) return;
    setSavingNote(true);
    try {
      const appended = task.notes
        ? `${task.notes}\n\n${noteInput.trim()}`
        : noteInput.trim();
      await updateDoc(doc(db, 'tasks', task.id), { notes: appended });
      task.notes = appended; // mutate local reference for immediate display
      setNoteInput('');
      toast.success('Nota guardada.');
    } catch (err) {
      console.error(err);
      toast.error('Error al guardar la nota.');
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div className={`bg-slate-800 border border-slate-700 border-l-4 ${STATUS_SECTIONS.find(s => s.id === localStatus)?.border || 'border-l-slate-500'} rounded-xl overflow-hidden`}>
      <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
        {/* Left: badges + title */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${typeCfg.badgeClass}`}>
              {typeCfg.label}
            </span>
            {task.calendarEventId && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-700 text-slate-400 border border-slate-600">
                Auto
              </span>
            )}
          </div>
          <p className="text-white font-semibold text-sm leading-snug truncate">{task.title}</p>
          {task.projectCode && (
            <p className="text-slate-500 text-xs mt-0.5 font-mono">[{task.projectCode}]</p>
          )}
          {task.dueDate && (
            <p className={`text-xs mt-1 ${dueDateColor}`}>
              Vence {format(parseISO(task.dueDate), "d 'de' MMMM", { locale: es })}
            </p>
          )}
        </div>

        {/* Right: status select + expand */}
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={localStatus}
            onChange={e => handleStatusChange(e.target.value)}
            className="px-2 py-1.5 bg-slate-900 border border-slate-600 rounded-lg text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {STATUS_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            onClick={() => setExpanded(v => !v)}
            className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors"
            title={expanded ? 'Colapsar notas' : 'Ver / agregar notas'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {task.type === 'reporte_tecnico' && task.calendarEventId && (
        <div className="px-4 pb-3">
          <button
            onClick={() => navigate(
              `/mis-tareas/informe/${task.calendarEventId}`
            )}
            className="w-full flex items-center justify-center gap-2 
                      py-2 px-4 bg-indigo-600 hover:bg-indigo-700 
                      text-white text-sm font-semibold rounded-xl 
                      transition-colors"
          >
            <FileText className="w-4 h-4" />
            Redactar informe
          </button>
        </div>
      )}

      {/* Expandable notes section */}
      {expanded && (
        <div className="border-t border-slate-700 px-4 py-3 bg-slate-900/40 space-y-3">
          {task.notes ? (
            <pre className="text-slate-300 text-xs whitespace-pre-wrap font-sans leading-relaxed">
              {task.notes}
            </pre>
          ) : (
            <p className="text-slate-600 text-xs italic">Sin notas todavía.</p>
          )}
          <div className="flex gap-2">
            <textarea
              value={noteInput}
              onChange={e => setNoteInput(e.target.value)}
              rows={2}
              placeholder="Añadir nota..."
              className="flex-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
            />
            <button
              onClick={handleSaveNote}
              disabled={!noteInput.trim() || savingNote}
              className="flex items-center justify-center px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg transition-colors"
              title="Guardar nota"
            >
              {savingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProfessionalTasks() {
  const { currentUser } = useAuth();
  const [tasks,   setTasks]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    const fetchTasks = async () => {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'tasks'),
            where('assignedTo', 'array-contains', currentUser.uid)
          )
        );
        setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error('Error al cargar tareas:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchTasks();
  }, [currentUser]);

  const handleStatusChange = (taskId, newStatus) => {
    setTasks(prev =>
      prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t)
    );
  };

  const grouped = useMemo(() => {
    return STATUS_SECTIONS.map(section => ({
      ...section,
      tasks: tasks.filter(t => t.status === section.id),
    }));
  }, [tasks]);

  const totalActive = tasks.filter(t => t.status !== 'completado').length;

  return (
    <Layout title="Mis Tareas">
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl p-4 animate-pulse">
              <div className="h-4 bg-slate-700 rounded w-1/4 mb-2" />
              <div className="h-5 bg-slate-700 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Sin tareas asignadas"
          description="No tienes tareas pendientes en este momento."
        />
      ) : (
        <div className="space-y-8">
          {totalActive > 0 && (
            <p className="text-slate-400 text-sm">
              Tienes <span className="text-white font-semibold">{totalActive}</span> tarea{totalActive !== 1 ? 's' : ''} activa{totalActive !== 1 ? 's' : ''}.
            </p>
          )}

          {grouped.map(section => (
            section.tasks.length === 0 ? null : (
              <div key={section.id}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-xs font-black uppercase tracking-widest ${section.color}`}>
                    {section.label}
                  </span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${section.ring} ${section.color}`}>
                    {section.tasks.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {section.tasks.map(task => (
                    <TaskRow key={task.id} task={task} onStatusChange={handleStatusChange} />
                  ))}
                </div>
              </div>
            )
          ))}
        </div>
      )}
    </Layout>
  );
}
