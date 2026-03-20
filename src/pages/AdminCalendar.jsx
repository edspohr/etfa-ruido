import { useState, useEffect, useMemo } from 'react';
import Layout from '../components/Layout';
import { db } from '../lib/firebase';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, where,
} from 'firebase/firestore';
import {
  format, startOfWeek, addDays, addWeeks, subWeeks,
  getWeek, differenceInDays, parseISO, isToday,
} from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, ChevronDown, X, Trash2 } from 'lucide-react';
import SearchableSelect from '../components/SearchableSelect';
import { toast } from 'sonner';
import FieldClosureModal from '../components/FieldClosureModal';
import { sortProjects } from '../utils/sort';

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Deterministically maps a user UID to one of 7 Tailwind bg-color classes. */
function getEngineerColor(uid) {
  if (!uid) return 'bg-indigo-500';
  const palette = [
    'bg-indigo-500', 'bg-teal-500', 'bg-violet-500',
    'bg-amber-500',  'bg-rose-500',  'bg-cyan-500',  'bg-emerald-500',
  ];
  const sum = uid.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return palette[sum % 7];
}

/**
 * Greedy lane-assignment so overlapping event bars are stacked vertically.
 * Events must already have weekStartCol / weekEndCol attached.
 */
function assignLanes(events) {
  const sorted = [...events].sort((a, b) => a.weekStartCol - b.weekStartCol);
  const lanes = [];
  for (const ev of sorted) {
    let placed = false;
    for (const lane of lanes) {
      if (lane[lane.length - 1].weekEndCol < ev.weekStartCol) {
        lane.push(ev);
        placed = true;
        break;
      }
    }
    if (!placed) lanes.push([ev]);
  }
  return lanes;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  projectId:    '',
  projectName:  '',
  projectCode:  '',
  title:        '',
  startDate:    '',
  endDate:      '',
  startTime:    '',
  endTime:      '',
  allDay:       true,
  ingenieros:   [],
  vehiculo:     '',
  equipamiento: '',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdminCalendar() {
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [events,        setEvents]        = useState([]);
  const [projects,      setProjects]      = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [loading,       setLoading]       = useState(true);

  // Modal
  const [modalOpen,     setModalOpen]     = useState(false);
  const [closureEvent,  setClosureEvent]  = useState(null);
  const [editingEvent,  setEditingEvent]  = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [formData,      setFormData]      = useState({ ...EMPTY_FORM });
  const [showIngDropdown, setShowIngDropdown] = useState(false);
  const [detailEvent,   setDetailEvent]   = useState(null);

  // ── Computed week values ──────────────────────────────────────────────────

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const weekEnd = weekDays[6];

  const weekStartStr = useMemo(() => format(weekStart, 'yyyy-MM-dd'), [weekStart]);
  const weekEndStr   = useMemo(() => format(weekEnd,   'yyyy-MM-dd'), [weekEnd]);

  const weekRangeLabel = useMemo(() => {
    const startDay = format(weekStart, 'd');
    const endDay   = format(weekEnd,   'd');
    const month    = format(weekEnd, 'MMMM', { locale: es });
    const year     = format(weekEnd, 'yyyy');
    const week     = getWeek(weekStart, { weekStartsOn: 1 });
    const capitalMonth = month.charAt(0).toUpperCase() + month.slice(1);
    return `${startDay}–${endDay} de ${capitalMonth} de ${year} (semana ${week})`;
  }, [weekStart, weekEnd]);

  // ── Data fetching ─────────────────────────────────────────────────────────

  const refreshEvents = async () => {
    const snap = await getDocs(collection(db, 'calendar_events'));
    setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const [projSnap, usersSnap, evSnap] = await Promise.all([
          getDocs(query(collection(db, 'projects'), where('status', '!=', 'deleted'))),
          getDocs(query(collection(db, 'users'),    where('role',   'in', ['professional', 'admin']))),
          getDocs(collection(db, 'calendar_events')),
        ]);

        setProjects(
          sortProjects(projSnap.docs.map(d => ({
            id:    d.id,
            label: `${d.data().code ? `[${d.data().code}] ` : ''}${d.data().name}`,
            value: d.id,
            ...d.data(),
          })))
        );
        setProfessionals(usersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setEvents(evSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error(e);
        toast.error('Error al cargar datos del calendario.');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  // ── Events clipped & positioned for the current week ─────────────────────

  const weekEvents = useMemo(() => {
    return events
      .filter(e => e.startDate <= weekEndStr && e.endDate >= weekStartStr)
      .map(e => {
        const effectiveStart = e.startDate < weekStartStr ? weekStartStr : e.startDate;
        const effectiveEnd   = e.endDate   > weekEndStr   ? weekEndStr   : e.endDate;
        return {
          ...e,
          weekStartCol:   differenceInDays(parseISO(effectiveStart), weekStart),
          weekEndCol:     differenceInDays(parseISO(effectiveEnd),   weekStart),
          continuesLeft:  e.startDate < weekStartStr,
          continuesRight: e.endDate   > weekEndStr,
        };
      });
  }, [events, weekStartStr, weekEndStr, weekStart]);

  const lanes = useMemo(() => assignLanes(weekEvents), [weekEvents]);

  // ── Week navigation ───────────────────────────────────────────────────────

  const goToPrevWeek = () => setWeekStart(w => subWeeks(w, 1));
  const goToNextWeek = () => setWeekStart(w => addWeeks(w, 1));
  const goToToday   = () => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));

  // ── Modal open / close ────────────────────────────────────────────────────

  const openCreateModal = (day) => {
    const dateStr = format(day, 'yyyy-MM-dd');
    setEditingEvent(null);
    setFormData({ ...EMPTY_FORM, startDate: dateStr, endDate: dateStr });
    setShowIngDropdown(false);
    setModalOpen(true);
  };

  const openEditModal = (ev) => {
    setEditingEvent(ev);
    setFormData({
      projectId:    ev.projectId    || '',
      projectName:  ev.projectName  || '',
      projectCode:  ev.projectCode  || '',
      title:        ev.title        || '',
      startDate:    ev.startDate    || '',
      endDate:      ev.endDate      || '',
      startTime:    ev.startTime    || '',
      endTime:      ev.endTime      || '',
      allDay:       ev.allDay !== false,
      ingenieros:   ev.ingenieros   || [],
      vehiculo:     ev.vehiculo     || '',
      equipamiento: ev.equipamiento || '',
    });
    setShowIngDropdown(false);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingEvent(null);
    setShowIngDropdown(false);
  };

  // ── Form field handlers ───────────────────────────────────────────────────

  const handleProjectSelect = (val) => {
    const proj = projects.find(p => p.id === val || p.value === val);
    setFormData(f => ({
      ...f,
      projectId:   proj?.id   || val,
      projectName: proj?.name || '',
      projectCode: proj?.code || '',
    }));
  };

  const toggleIngeniero = (uid) => {
    setFormData(f => ({
      ...f,
      ingenieros: f.ingenieros.includes(uid)
        ? f.ingenieros.filter(id => id !== uid)
        : [...f.ingenieros, uid],
    }));
  };

  // ── CRUD operations ───────────────────────────────────────────────────────

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.projectId || !formData.startDate || !formData.endDate) {
      toast.error('Complete los campos obligatorios (proyecto y fechas).');
      return;
    }
    if (formData.endDate < formData.startDate) {
      toast.error('La fecha de término no puede ser anterior a la de inicio.');
      return;
    }
    setSaving(true);
    try {
      const ingenierosNames = formData.ingenieros.map(uid => {
        const u = professionals.find(p => p.id === uid);
        return u?.displayName || uid;
      });
      const payload = {
        projectId:      formData.projectId,
        projectName:    formData.projectName,
        projectCode:    formData.projectCode,
        title:          formData.title || formData.projectName,
        startDate:      formData.startDate,
        endDate:        formData.endDate,
        startTime:      formData.allDay ? null : (formData.startTime || null),
        endTime:        formData.allDay ? null : (formData.endTime   || null),
        allDay:         formData.allDay,
        ingenieros:     formData.ingenieros,
        ingenierosNames,
        vehiculo:       formData.vehiculo,
        equipamiento:   formData.equipamiento,
      };

      if (editingEvent) {
        await updateDoc(doc(db, 'calendar_events', editingEvent.id), payload);
        toast.success('Evento actualizado.');
      } else {
        await addDoc(collection(db, 'calendar_events'), {
          ...payload,
          status:    'scheduled',
          closedAt:  null,
          createdBy: 'admin',
          createdAt: serverTimestamp(),
        });
        toast.success('Evento creado.');
      }
      closeModal();
      await refreshEvents();
    } catch (err) {
      console.error(err);
      toast.error('Error al guardar evento.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingEvent) return;
    if (!window.confirm('¿Eliminar este evento definitivamente?')) return;
    try {
      await deleteDoc(doc(db, 'calendar_events', editingEvent.id));
      toast.success('Evento eliminado.');
      closeModal();
      await refreshEvents();
    } catch (err) {
      console.error(err);
      toast.error('Error al eliminar evento.');
    }
  };

  const handleCloseEvent = (ev) => {
    setClosureEvent(ev);
  };

  // ── Lane renderer ─────────────────────────────────────────────────────────

  const renderLane = (lane) => {
    const cells = [];
    let col = 0;

    for (const ev of lane) {
      // Gap before this event
      const gap = ev.weekStartCol - col;
      if (gap > 0) {
        cells.push(
          <div
            key={`gap-${col}-${ev.id}`}
            style={{ gridColumn: `span ${gap}` }}
            className="h-8"
          />
        );
      }

      const span       = ev.weekEndCol - ev.weekStartCol + 1;
      const colorClass = getEngineerColor(ev.ingenieros?.[0]);
      const isClosed   = ev.status === 'closed';
      const label      = `${ev.projectCode ? `[${ev.projectCode}] ` : ''}${
        ev.ingenierosNames?.join(', ') || ev.title || ev.projectName
      }`;

      cells.push(
        <div
          key={ev.id}
          style={{ gridColumn: `span ${span}` }}
          className={[
            'group relative h-8 flex items-center px-2 rounded-md cursor-pointer',
            'text-white text-xs font-medium pointer-events-auto overflow-hidden select-none',
            isClosed ? 'bg-slate-600 opacity-60' : colorClass,
            ev.continuesLeft  ? 'rounded-l-none pl-1' : '',
            ev.continuesRight ? 'rounded-r-none pr-1' : '',
          ].join(' ')}
          onClick={e => { e.stopPropagation(); setDetailEvent(ev); }}
          title={label}
        >
          <span className="truncate leading-none">{label}</span>

          {isClosed && (
            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] font-bold text-white/60 shrink-0">
              ✓
            </span>
          )}

          {!isClosed && (
            <button
              className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 bg-red-600 hover:bg-red-700 text-white text-[9px] font-black px-1.5 py-0.5 rounded transition-opacity pointer-events-auto whitespace-nowrap"
              onClick={e => { e.stopPropagation(); handleCloseEvent(ev); }}
            >
              Cerrar
            </button>
          )}
        </div>
      );

      col = ev.weekEndCol + 1;
    }

    // Trailing gap
    if (col < 7) {
      cells.push(
        <div
          key={`after-${col}`}
          style={{ gridColumn: `span ${7 - col}` }}
          className="h-8"
        />
      );
    }

    return cells;
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <Layout title="Calendario de Terreno">Cargando...</Layout>;

  const eventsAreaMinH = Math.max(80, lanes.length * 36 + 24);

  return (
    <Layout title="Calendario de Terreno">

      {/* ── Week navigator ── */}
      <div className="bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button
            onClick={goToPrevWeek}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl text-sm font-medium transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Semana anterior
          </button>
          <button
            onClick={goToToday}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            Hoy
          </button>
          <button
            onClick={goToNextWeek}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl text-sm font-medium transition-colors"
          >
            Semana siguiente
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <p className="text-slate-200 font-semibold text-sm sm:text-base">{weekRangeLabel}</p>
      </div>

      {/* ── Calendar grid ── */}
      <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden mb-6">

        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-slate-700">
          {weekDays.map((day, i) => {
            const today = isToday(day);
            return (
              <div
                key={i}
                className={[
                  'py-3 px-2 text-center text-xs sm:text-sm font-semibold',
                  'border-r border-slate-700 last:border-r-0',
                  today ? 'text-indigo-300 bg-indigo-500/10' : 'text-slate-400',
                ].join(' ')}
              >
                {format(day, 'EEE d', { locale: es })}
              </div>
            );
          })}
        </div>

        {/* Events area */}
        <div className="relative" style={{ minHeight: `${eventsAreaMinH}px` }}>

          {/* Background – invisible day cells that handle "create" clicks */}
          <div className="absolute inset-0 grid grid-cols-7">
            {weekDays.map((day, i) => (
              <div
                key={i}
                onClick={() => openCreateModal(day)}
                title={`Agregar evento el ${format(day, "d 'de' MMMM", { locale: es })}`}
                className="border-r border-slate-700/40 last:border-r-0 cursor-pointer hover:bg-slate-700/20 transition-colors"
              />
            ))}
          </div>

          {/* Events overlay – pointer-events-none so empty areas fall through to background */}
          <div className="relative z-10 p-2 pointer-events-none">
            {lanes.length === 0 ? (
              <div className="flex items-center justify-center h-16">
                <p className="text-slate-500 text-sm">
                  Sin eventos esta semana · Haz clic en un día para agregar
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {lanes.map((lane, i) => (
                  <div key={i} className="grid grid-cols-7 gap-x-0.5">
                    {renderLane(lane)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Side Detail Panel ── */}
      {detailEvent && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div 
            className="absolute inset-0 bg-black/40" 
            onClick={() => setDetailEvent(null)} 
          />
          <div className="relative w-full max-w-sm bg-slate-800 border-l border-slate-700 h-full overflow-y-auto shadow-2xl flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <div>
                <p className="text-indigo-400 text-xs font-mono font-bold">
                  {detailEvent.projectCode && `[${detailEvent.projectCode}]`}
                </p>
                <h2 className="text-white font-bold text-base leading-snug">
                  {detailEvent.projectName}
                </h2>
              </div>
              <button onClick={() => setDetailEvent(null)} className="text-slate-400 hover:text-white transition-colors p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* Body */}
            <div className="px-5 py-4 space-y-4 flex-1">
              {/* Dates */}
              <div>
                <p className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1">Período</p>
                <p className="text-slate-200 text-sm">
                  {detailEvent.startDate} → {detailEvent.endDate}
                </p>
              </div>
              {/* Ingenieros */}
              {detailEvent.ingenierosNames?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1">Equipo</p>
                  <div className="flex flex-wrap gap-1.5">
                    {detailEvent.ingenierosNames.map((name, i) => (
                      <span key={i} className="px-2.5 py-1 bg-slate-700 text-slate-200 rounded-full text-xs font-medium">
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {/* Recursos */}
              {detailEvent.vehiculo && (
                <div>
                  <p className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1">Vehículo</p>
                  <p className="text-slate-200 text-sm">{detailEvent.vehiculo}</p>
                </div>
              )}
              {detailEvent.equipamiento && (
                <div>
                  <p className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1">Equipamiento</p>
                  <p className="text-slate-200 text-sm">{detailEvent.equipamiento}</p>
                </div>
              )}
              {/* Status */}
              <div>
                <p className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1">Estado</p>
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase ${detailEvent.status === 'closed' ? 'bg-slate-600 text-slate-300' : 'bg-indigo-500/20 text-indigo-300'}`}>
                  {detailEvent.status === 'closed' ? 'Cerrado' : 'Programado'}
                </span>
              </div>
            </div>
            {/* Actions */}
            <div className="px-5 py-4 border-t border-slate-700 space-y-2">
              <button
                onClick={() => { openEditModal(detailEvent); setDetailEvent(null); }}
                className="w-full py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                Editar evento
              </button>
              {detailEvent.status !== 'closed' && (
                <button
                  onClick={() => { handleCloseEvent(detailEvent); setDetailEvent(null); }}
                  className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  Cerrar terreno
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Event modal ── */}
      {modalOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={closeModal}
        >
          <div
            className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
              <h2 className="text-white font-bold text-lg">
                {editingEvent ? 'Editar evento de terreno' : 'Nuevo evento de terreno'}
              </h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="px-6 py-5 space-y-4">

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

              {/* Título */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Título del evento
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={e => setFormData(f => ({ ...f, title: e.target.value }))}
                  placeholder="Se usará el nombre del proyecto si se deja vacío"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Fechas */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    Fecha inicio <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={e => setFormData(f => ({ ...f, startDate: e.target.value }))}
                    required
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    Fecha término <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="date"
                    value={formData.endDate}
                    onChange={e => setFormData(f => ({ ...f, endDate: e.target.value }))}
                    required
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Día completo toggle */}
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.allDay}
                  onChange={e => setFormData(f => ({ ...f, allDay: e.target.checked }))}
                  className="w-4 h-4 rounded border-slate-600 accent-indigo-500"
                />
                <span className="text-sm font-medium text-slate-300">Día completo</span>
              </label>

              {!formData.allDay && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Hora inicio</label>
                    <input
                      type="time"
                      value={formData.startTime}
                      onChange={e => setFormData(f => ({ ...f, startTime: e.target.value }))}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Hora término</label>
                    <input
                      type="time"
                      value={formData.endTime}
                      onChange={e => setFormData(f => ({ ...f, endTime: e.target.value }))}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              )}

              {/* Ingenieros multi-select */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Ingenieros asignados
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowIngDropdown(v => !v)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-left flex justify-between items-center focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-300"
                  >
                    <span>
                      {formData.ingenieros.length === 0
                        ? 'Seleccionar ingenieros...'
                        : `${formData.ingenieros.length} seleccionado(s)`}
                    </span>
                    <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${showIngDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  {showIngDropdown && (
                    <div className="absolute z-20 w-full bg-slate-900 border border-slate-600 rounded-lg shadow-xl mt-1 max-h-44 overflow-y-auto">
                      {professionals.length === 0 ? (
                        <p className="px-3 py-2 text-sm text-slate-500">No hay profesionales disponibles.</p>
                      ) : (
                        professionals.map(u => (
                          <label
                            key={u.id}
                            className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-800 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={formData.ingenieros.includes(u.id)}
                              onChange={() => toggleIngeniero(u.id)}
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
                {formData.ingenieros.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {formData.ingenieros.map(uid => {
                      const u = professionals.find(p => p.id === uid);
                      return (
                        <span
                          key={uid}
                          className={`${getEngineerColor(uid)} text-white text-xs font-medium px-2.5 py-0.5 rounded-full`}
                        >
                          {u?.displayName || uid}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Vehículo */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Vehículo</label>
                <input
                  type="text"
                  value={formData.vehiculo}
                  onChange={e => setFormData(f => ({ ...f, vehiculo: e.target.value }))}
                  placeholder="Ej: Auto arrendado KIA - Patente XY1234"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Equipamiento */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Equipamiento</label>
                <input
                  type="text"
                  value={formData.equipamiento}
                  onChange={e => setFormData(f => ({ ...f, equipamiento: e.target.value }))}
                  placeholder="Ej: SLM5253 + KIA + GRM"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Form actions */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-700">
                <div>
                  {editingEvent && (
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
                    {saving ? 'Guardando...' : editingEvent ? 'Guardar cambios' : 'Crear evento'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
      <FieldClosureModal
        isOpen={!!closureEvent}
        calendarEvent={closureEvent}
        onClose={() => setClosureEvent(null)}
        onClosed={refreshEvents}
      />
    </Layout>
  );
}
