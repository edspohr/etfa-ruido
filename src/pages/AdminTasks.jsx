import { useState, useEffect, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import Layout from '../components/Layout';
import { db } from '../lib/firebase';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, where,
} from 'firebase/firestore';
import { format, parseISO, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { Plus, X, Trash2, ChevronDown } from 'lucide-react';
import SearchableSelect from '../components/SearchableSelect';
import { toast } from 'sonner';

// ── Constants & utilities ─────────────────────────────────────────────────────

const COLUMNS = [
  {
    id:     'pendiente',
    label:  'Pendiente',
    color:  'text-amber-400',
    border: 'border-t-amber-500',
    ring:   'bg-amber-500/10',
  },
  {
    id:     'en_progreso',
    label:  'En Progreso',
    color:  'text-indigo-400',
    border: 'border-t-indigo-500',
    ring:   'bg-indigo-500/10',
  },
  {
    id:     'completado',
    label:  'Completado',
    color:  'text-emerald-400',
    border: 'border-t-emerald-500',
    ring:   'bg-emerald-500/10',
  },
];

const TYPE_CONFIG = {
  reporte_tecnico: {
    label:   'Rep. Técnico',
    badgeClass: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
  },
  reporte_flash: {
    label:   'Rep. Flash',
    badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  },
  informe: {
    label:   'Informe',
    badgeClass: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  },
};

const STATUS_OPTIONS = [
  { value: 'pendiente',   label: 'Pendiente' },
  { value: 'en_progreso', label: 'En Progreso' },
  { value: 'completado',  label: 'Completado' },
];

/** Same deterministic color logic as AdminCalendar.jsx */
function getEngineerColor(uid) {
  if (!uid) return 'bg-indigo-500';
  const palette = [
    'bg-indigo-500', 'bg-teal-500', 'bg-violet-500',
    'bg-amber-500',  'bg-rose-500',  'bg-cyan-500',  'bg-emerald-500',
  ];
  const sum = uid.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return palette[sum % 7];
}

/** Returns a Tailwind text-color class based on proximity to due date. */
function getDueDateColor(dueDate) {
  if (!dueDate) return 'text-slate-500';
  const todayStr    = format(new Date(), 'yyyy-MM-dd');
  const in2DaysStr  = format(addDays(new Date(), 2), 'yyyy-MM-dd');
  if (dueDate < todayStr)    return 'text-red-400';
  if (dueDate <= in2DaysStr) return 'text-amber-400';
  return 'text-slate-500';
}

const EMPTY_FORM = {
  type:        'reporte_flash',
  projectId:   '',
  projectName: '',
  projectCode: '',
  assignedTo:  [],
  dueDate:     format(new Date(), 'yyyy-MM-dd'),
  notes:       '',
  status:      'pendiente',
};

// ── Sub-component: Task card ──────────────────────────────────────────────────

function TaskCard({ task }) {
  const typeConf    = TYPE_CONFIG[task.type] || TYPE_CONFIG.informe;
  const dueCls      = getDueDateColor(task.dueDate);
  const dueFmt      = task.dueDate
    ? format(parseISO(task.dueDate), "d MMM", { locale: es })
    : null;

  return (
    <div className="bg-slate-900 border border-slate-700/60 rounded-xl p-3 hover:border-slate-600 transition-colors space-y-2.5">

      {/* Type + Auto badge */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${typeConf.badgeClass}`}>
          {typeConf.label}
        </span>
        {task.createdBy === 'system' && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-700/50 text-slate-400 border-slate-600/50">
            Auto
          </span>
        )}
      </div>

      {/* Project + title */}
      <div>
        <p className="text-sm font-semibold text-slate-100 leading-snug">{task.title}</p>
        {task.projectCode && (
          <p className="text-xs text-slate-500 font-mono mt-0.5">[{task.projectCode}] {task.projectName}</p>
        )}
      </div>

      {/* Footer: avatars + due date */}
      <div className="flex items-center justify-between">
        {/* Engineer avatar stack */}
        <div className="flex -space-x-1.5">
          {(task.assignedTo || []).slice(0, 4).map((uid, i) => {
            const name = task.assignedToNames?.[i] || uid;
            const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
            return (
              <div
                key={uid}
                title={name}
                className={`w-6 h-6 rounded-full ${getEngineerColor(uid)} flex items-center justify-center text-white text-[9px] font-bold border-2 border-slate-900`}
              >
                {initials}
              </div>
            );
          })}
          {(task.assignedTo || []).length > 4 && (
            <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-slate-300 text-[9px] font-bold border-2 border-slate-900">
              +{task.assignedTo.length - 4}
            </div>
          )}
          {(task.assignedTo || []).length === 0 && (
            <span className="text-xs text-slate-600 italic">Sin asignar</span>
          )}
        </div>

        {/* Due date */}
        {dueFmt && (
          <span className={`text-xs font-semibold ${dueCls}`}>{dueFmt}</span>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminTasks() {
  const [tasks,         setTasks]         = useState([]);
  const [projects,      setProjects]      = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [loading,       setLoading]       = useState(true);

  // Filters
  const [filterAssignee, setFilterAssignee] = useState('todos');
  const [filterType,     setFilterType]     = useState('todos');

  // Modal
  const [modalOpen,         setModalOpen]         = useState(false);
  const [editingTask,       setEditingTask]        = useState(null);
  const [formData,          setFormData]           = useState({ ...EMPTY_FORM });
  const [saving,            setSaving]             = useState(false);
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const refreshTasks = async () => {
    const snap = await getDocs(collection(db, 'tasks'));
    setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const [tasksSnap, projSnap, usersSnap] = await Promise.all([
          getDocs(collection(db, 'tasks')),
          getDocs(query(collection(db, 'projects'), where('status', '!=', 'deleted'))),
          getDocs(query(collection(db, 'users'),    where('role',   'in', ['professional', 'admin']))),
        ]);
        setTasks(tasksSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setProjects(
          projSnap.docs.map(d => ({
            id:    d.id,
            label: `${d.data().code ? `[${d.data().code}] ` : ''}${d.data().name}`,
            value: d.id,
            ...d.data(),
          }))
        );
        setProfessionals(usersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error(e);
        toast.error('Error al cargar tareas.');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  // ── Filtered view ──────────────────────────────────────────────────────────

  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      if (filterAssignee !== 'todos' && !(t.assignedTo || []).includes(filterAssignee)) return false;
      if (filterType     !== 'todos' && t.type !== filterType) return false;
      return true;
    });
  }, [tasks, filterAssignee, filterType]);

  // ── Drag & drop ────────────────────────────────────────────────────────────

  const handleDragEnd = async (result) => {
    if (!result.destination) return;
    const { draggableId, source, destination } = result;
    if (source.droppableId === destination.droppableId) return;

    const newStatus = destination.droppableId;

    // Optimistic update
    setTasks(prev => prev.map(t => t.id === draggableId ? { ...t, status: newStatus } : t));

    try {
      await updateDoc(doc(db, 'tasks', draggableId), {
        status:      newStatus,
        completedAt: newStatus === 'completado' ? serverTimestamp() : null,
      });
    } catch (err) {
      console.error(err);
      toast.error('Error al mover tarea.');
      // Revert
      setTasks(prev => prev.map(t => t.id === draggableId ? { ...t, status: source.droppableId } : t));
    }
  };

  // ── Modal helpers ──────────────────────────────────────────────────────────

  const openCreateModal = () => {
    setEditingTask(null);
    setFormData({ ...EMPTY_FORM });
    setShowAssignDropdown(false);
    setModalOpen(true);
  };

  const openEditModal = (task) => {
    setEditingTask(task);
    setFormData({
      type:        task.type        || 'reporte_flash',
      projectId:   task.projectId   || '',
      projectName: task.projectName || '',
      projectCode: task.projectCode || '',
      assignedTo:  task.assignedTo  || [],
      dueDate:     task.dueDate     || '',
      notes:       task.notes       || '',
      status:      task.status      || 'pendiente',
    });
    setShowAssignDropdown(false);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingTask(null);
    setShowAssignDropdown(false);
  };

  const handleProjectSelect = (val) => {
    const proj = projects.find(p => p.id === val || p.value === val);
    setFormData(f => ({
      ...f,
      projectId:   proj?.id   || val,
      projectName: proj?.name || '',
      projectCode: proj?.code || '',
    }));
  };

  const toggleAssignee = (uid) => {
    setFormData(f => ({
      ...f,
      assignedTo: f.assignedTo.includes(uid)
        ? f.assignedTo.filter(id => id !== uid)
        : [...f.assignedTo, uid],
    }));
  };

  // ── CRUD ───────────────────────────────────────────────────────────────────

  const handleSave = async (e) => {
    e.preventDefault();
    if (!editingTask && !formData.projectId) {
      toast.error('Selecciona un proyecto.');
      return;
    }
    setSaving(true);
    try {
      const assignedToNames = formData.assignedTo.map(uid => {
        const u = professionals.find(p => p.id === uid);
        return u?.displayName || uid;
      });

      if (editingTask) {
        await updateDoc(doc(db, 'tasks', editingTask.id), {
          status:          formData.status,
          assignedTo:      formData.assignedTo,
          assignedToNames,
          dueDate:         formData.dueDate,
          notes:           formData.notes,
          completedAt:     formData.status === 'completado' ? serverTimestamp() : null,
        });
        toast.success('Tarea actualizada.');
      } else {
        const typeLabel = TYPE_CONFIG[formData.type]?.label || formData.type;
        await addDoc(collection(db, 'tasks'), {
          type:            formData.type,
          title:           `${typeLabel} — ${formData.projectName}`,
          projectId:       formData.projectId,
          projectName:     formData.projectName,
          projectCode:     formData.projectCode,
          assignedTo:      formData.assignedTo,
          assignedToNames,
          dueDate:         formData.dueDate,
          status:          'pendiente',
          calendarEventId: null,
          createdBy:       'admin',
          createdAt:       serverTimestamp(),
          completedAt:     null,
          notes:           formData.notes,
        });
        toast.success('Tarea creada.');
      }
      closeModal();
      await refreshTasks();
    } catch (err) {
      console.error(err);
      toast.error('Error al guardar tarea.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingTask) return;
    if (!window.confirm('¿Eliminar esta tarea definitivamente?')) return;
    try {
      await deleteDoc(doc(db, 'tasks', editingTask.id));
      toast.success('Tarea eliminada.');
      closeModal();
      await refreshTasks();
    } catch (err) {
      console.error(err);
      toast.error('Error al eliminar tarea.');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return <Layout title="Planner de Tareas">Cargando...</Layout>;

  return (
    <Layout title="Planner de Tareas" isFullWidth>

      {/* ── Top bar: filters + new task ── */}
      <div className="flex flex-wrap items-center gap-3 mb-6">

        {/* Assignee filter */}
        <select
          value={filterAssignee}
          onChange={e => setFilterAssignee(e.target.value)}
          className="px-3 py-2 bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="todos">Todos los asignados</option>
          {professionals.map(u => (
            <option key={u.id} value={u.id}>{u.displayName}</option>
          ))}
        </select>

        {/* Type filter */}
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="px-3 py-2 bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="todos">Todos los tipos</option>
          <option value="reporte_tecnico">Reporte Técnico</option>
          <option value="reporte_flash">Reporte Flash</option>
          <option value="informe">Informe</option>
        </select>

        <span className="text-slate-600 text-sm hidden sm:inline">
          {filteredTasks.length} tarea{filteredTasks.length !== 1 ? 's' : ''}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Nueva tarea */}
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Nueva Tarea
        </button>
      </div>

      {/* ── Kanban board ── */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {COLUMNS.map(col => {
            const colTasks = filteredTasks.filter(t => t.status === col.id);
            return (
              <div
                key={col.id}
                className={`bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden flex flex-col border-t-2 ${col.border}`}
              >
                {/* Column header */}
                <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between shrink-0">
                  <span className={`font-bold text-sm ${col.color}`}>{col.label}</span>
                  <span className="text-xs text-slate-500 bg-slate-700 px-2 py-0.5 rounded-full font-semibold">
                    {colTasks.length}
                  </span>
                </div>

                {/* Droppable zone */}
                <Droppable droppableId={col.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={[
                        'flex-1 p-3 space-y-2.5 min-h-32 transition-colors',
                        snapshot.isDraggingOver ? col.ring : '',
                      ].join(' ')}
                    >
                      {colTasks.map((task, index) => (
                        <Draggable key={task.id} draggableId={task.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={`transition-shadow ${snapshot.isDragging ? 'shadow-2xl rotate-1 opacity-90' : ''}`}
                            >
                              {/* Inner click target — doesn't interfere with drag */}
                              <div onClick={() => openEditModal(task)}>
                                <TaskCard task={task} />
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}

                      {colTasks.length === 0 && !snapshot.isDraggingOver && (
                        <div className="flex items-center justify-center h-16">
                          <p className="text-slate-600 text-xs">Sin tareas</p>
                        </div>
                      )}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>

      {/* ── Modal (create + edit) ── */}
      {modalOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={closeModal}
        >
          <div
            className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
              <h2 className="text-white font-bold text-lg">
                {editingTask ? 'Detalle de tarea' : 'Nueva tarea'}
              </h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="px-6 py-5 space-y-4">

              {/* ── CREATE-ONLY fields ── */}
              {!editingTask && (
                <>
                  {/* Tipo */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Tipo de tarea</label>
                    <select
                      value={formData.type}
                      onChange={e => setFormData(f => ({ ...f, type: e.target.value }))}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="reporte_tecnico">Reporte Técnico</option>
                      <option value="reporte_flash">Reporte Flash</option>
                      <option value="informe">Informe</option>
                    </select>
                  </div>

                  {/* Proyecto */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">
                      Proyecto <span className="text-rose-400">*</span>
                    </label>
                    <SearchableSelect
                      options={projects}
                      value={formData.projectId}
                      onChange={handleProjectSelect}
                      placeholder="Seleccionar proyecto..."
                    />
                  </div>
                </>
              )}

              {/* ── EDIT-ONLY: task info banner ── */}
              {editingTask && (
                <div className="bg-slate-900 rounded-xl p-3 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${TYPE_CONFIG[editingTask.type]?.badgeClass}`}>
                      {TYPE_CONFIG[editingTask.type]?.label}
                    </span>
                    {editingTask.createdBy === 'system' && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-700/50 text-slate-400 border-slate-600/50">Auto</span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-slate-100">{editingTask.title}</p>
                  {editingTask.projectCode && (
                    <p className="text-xs text-slate-500 font-mono">[{editingTask.projectCode}] {editingTask.projectName}</p>
                  )}
                </div>
              )}

              {/* Estado */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Estado</label>
                <select
                  value={formData.status}
                  onChange={e => setFormData(f => ({ ...f, status: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {STATUS_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Fecha límite */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Fecha límite</label>
                <input
                  type="date"
                  value={formData.dueDate}
                  onChange={e => setFormData(f => ({ ...f, dueDate: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Ingenieros asignados */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Ingenieros asignados</label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowAssignDropdown(v => !v)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-left flex justify-between items-center focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-300"
                  >
                    <span>
                      {formData.assignedTo.length === 0
                        ? 'Seleccionar ingenieros...'
                        : `${formData.assignedTo.length} seleccionado(s)`}
                    </span>
                    <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${showAssignDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  {showAssignDropdown && (
                    <div className="absolute z-20 w-full bg-slate-900 border border-slate-600 rounded-lg shadow-xl mt-1 max-h-44 overflow-y-auto">
                      {professionals.length === 0 ? (
                        <p className="px-3 py-2 text-sm text-slate-500">No hay profesionales disponibles.</p>
                      ) : (
                        professionals.map(u => (
                          <label key={u.id} className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-800 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={formData.assignedTo.includes(u.id)}
                              onChange={() => toggleAssignee(u.id)}
                              className="w-4 h-4 rounded"
                            />
                            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${getEngineerColor(u.id)}`} />
                            <span className="text-sm text-slate-200">{u.displayName}</span>
                          </label>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {formData.assignedTo.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {formData.assignedTo.map(uid => {
                      const u = professionals.find(p => p.id === uid);
                      return (
                        <span key={uid} className={`${getEngineerColor(uid)} text-white text-xs font-medium px-2.5 py-0.5 rounded-full`}>
                          {u?.displayName || uid}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Notas */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Notas</label>
                <textarea
                  value={formData.notes}
                  onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  placeholder="Observaciones, comentarios, links..."
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-700">
                <div>
                  {editingTask && (
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      Eliminar
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors"
                  >
                    {saving ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
