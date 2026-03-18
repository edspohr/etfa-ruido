import { useState, useEffect, useMemo } from 'react';
import Layout from '../components/Layout';
import EmptyState from '../components/EmptyState';
import FieldClosureModal from '../components/FieldClosureModal';
import { db } from '../lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import {
  format, startOfWeek, addDays, addWeeks, subWeeks,
  getWeek, differenceInDays, parseISO, isToday,
} from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { useAuth } from '../context/useAuth';

// ── Utilities (same as AdminCalendar) ────────────────────────────────────────

function getEngineerColor(uid) {
  if (!uid) return 'bg-indigo-500';
  const palette = [
    'bg-indigo-500', 'bg-teal-500', 'bg-violet-500',
    'bg-amber-500',  'bg-rose-500',  'bg-cyan-500',  'bg-emerald-500',
  ];
  const sum = uid.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return palette[sum % 7];
}

function assignLanes(events) {
  const sorted = [...events].sort((a, b) => a.weekStartCol - b.weekStartCol);
  const lanes  = [];
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProfessionalCalendar() {
  const { currentUser } = useAuth();

  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [events,       setEvents]       = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [closureEvent, setClosureEvent] = useState(null);

  // ── Week computations ─────────────────────────────────────────────────────

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const weekEnd = weekDays[6];

  const weekStartStr = useMemo(() => format(weekStart, 'yyyy-MM-dd'), [weekStart]);
  const weekEndStr   = useMemo(() => format(weekEnd,   'yyyy-MM-dd'), [weekEnd]);

  const weekRangeLabel = useMemo(() => {
    const startDay   = format(weekStart, 'd');
    const endDay     = format(weekEnd,   'd');
    const month      = format(weekEnd,   'MMMM', { locale: es });
    const year       = format(weekEnd,   'yyyy');
    const week       = getWeek(weekStart, { weekStartsOn: 1 });
    const capitalMonth = month.charAt(0).toUpperCase() + month.slice(1);
    return `${startDay}–${endDay} de ${capitalMonth} de ${year} (semana ${week})`;
  }, [weekStart, weekEnd]);

  // ── Data fetching ─────────────────────────────────────────────────────────

  const refreshEvents = async () => {
    if (!currentUser) return;
    // NOTE: array-contains on `ingenieros` — single-field index, no extra Firestore index needed
    const snap = await getDocs(
      query(
        collection(db, 'calendar_events'),
        where('ingenieros', 'array-contains', currentUser.uid)
      )
    );
    setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);
    refreshEvents().finally(() => setLoading(false));
  }, [currentUser]);

  // ── Events positioned for current week ───────────────────────────────────

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

  // ── Lane renderer (read-only — no edit on click, only Cerrar for open events) ─

  const renderLane = (lane) => {
    const cells = [];
    let col = 0;

    for (const ev of lane) {
      const gap = ev.weekStartCol - col;
      if (gap > 0) {
        cells.push(
          <div key={`gap-${col}-${ev.id}`} style={{ gridColumn: `span ${gap}` }} className="h-8" />
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
            'group relative h-8 flex items-center px-2 rounded-md',
            'text-white text-xs font-medium pointer-events-auto overflow-hidden select-none',
            isClosed ? 'bg-slate-600 opacity-60 cursor-default' : `${colorClass} cursor-default`,
            ev.continuesLeft  ? 'rounded-l-none pl-1' : '',
            ev.continuesRight ? 'rounded-r-none pr-1' : '',
          ].join(' ')}
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
              onClick={e => { e.stopPropagation(); setClosureEvent(ev); }}
            >
              Cerrar
            </button>
          )}
        </div>
      );

      col = ev.weekEndCol + 1;
    }

    if (col < 7) {
      cells.push(
        <div key={`after-${col}`} style={{ gridColumn: `span ${7 - col}` }} className="h-8" />
      );
    }

    return cells;
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <Layout title="Mi Calendario">Cargando...</Layout>;

  const eventsAreaMinH = Math.max(80, lanes.length * 36 + 24);

  return (
    <Layout title="Mi Calendario">

      {/* Week navigator */}
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

      {/* Calendar grid */}
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

          {/* Background grid (non-interactive for professional) */}
          <div className="absolute inset-0 grid grid-cols-7">
            {weekDays.map((_, i) => (
              <div key={i} className="border-r border-slate-700/40 last:border-r-0" />
            ))}
          </div>

          {/* Events overlay */}
          <div className="relative z-10 p-2 pointer-events-none">
            {lanes.length === 0 ? (
              <EmptyState
                icon={Calendar}
                title="Sin eventos esta semana"
                description="No tienes terrenos asignados en este período."
              />
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

      <FieldClosureModal
        isOpen={!!closureEvent}
        calendarEvent={closureEvent}
        onClose={() => setClosureEvent(null)}
        onClosed={refreshEvents}
      />
    </Layout>
  );
}
