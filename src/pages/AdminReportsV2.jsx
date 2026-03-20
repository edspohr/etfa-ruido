import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../lib/firebase';
import { 
  collection, getDocs, updateDoc, doc, query, 
  where, orderBy, serverTimestamp 
} from 'firebase/firestore';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { 
  CheckCircle, XCircle, ChevronDown, ChevronUp, 
  FileText, User, Loader2, ExternalLink
} from 'lucide-react';
import { toast } from 'sonner';

import Layout from '../components/Layout';
import EmptyState from '../components/EmptyState';
import { REPORT_STATUSES } from '../utils/reportSchema';

export default function AdminReportsV2() {
  const [reports, setReports] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // UI States
  const [expandedReportId, setExpandedReportId] = useState(null);
  const [apuntesMap, setApuntesMap] = useState({}); // { reportId: [apuntes] }
  const [loadingApuntes, setLoadingApuntes] = useState(false);
  const [assigneeSelections, setAssigneeSelections] = useState({}); // { reportId: userId }
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      // Fetch all reports
      const qReports = query(collection(db, 'reports'), orderBy('createdAt', 'desc'));
      const rSnap = await getDocs(qReports);
      setReports(rSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      // Fetch all professionals/admins
      const qUsers = query(collection(db, 'users'), where('role', 'in', ['professional', 'admin']));
      const uSnap = await getDocs(qUsers);
      setUsers(uSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error("Error fetching admin reports:", err);
      toast.error("Error al cargar los informes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchApuntes = async (reportId) => {
    if (apuntesMap[reportId]) return; // Already loaded
    
    setLoadingApuntes(true);
    try {
      const q = query(
        collection(db, 'reports', reportId, 'apuntes'),
        orderBy('createdAt', 'asc')
      );
      const snap = await getDocs(q);
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setApuntesMap(prev => ({ ...prev, [reportId]: data }));
    } catch (err) {
      console.error("Error fetching apuntes:", err);
      toast.error("Error al cargar apuntes.");
    } finally {
      setLoadingApuntes(false);
    }
  };

  const handleToggleApuntes = (reportId) => {
    if (expandedReportId === reportId) {
      setExpandedReportId(null);
    } else {
      setExpandedReportId(reportId);
      fetchApuntes(reportId);
    }
  };

  const handleAssign = async (reportId) => {
    const selectedUserId = assigneeSelections[reportId];
    if (!selectedUserId) {
      toast.error("Selecciona un redactor primero.");
      return;
    }

    const user = users.find(u => u.id === selectedUserId);
    if (!user) return;

    try {
      await updateDoc(doc(db, 'reports', reportId), {
        assignedToId: user.id,
        assignedToName: user.displayName || user.email,
        status: REPORT_STATUSES.IN_PROGRESS,
        updatedAt: serverTimestamp()
      });
      toast.success(`Informe asignado a ${user.displayName || user.email}.`);
      fetchData();
    } catch (err) {
      console.error(err);
      toast.error("Error al asignar informe.");
    }
  };

  const handleApprove = async (reportId) => {
    if (!window.confirm("¿Aprobar este informe?")) return;

    try {
      await updateDoc(doc(db, 'reports', reportId), {
        status: REPORT_STATUSES.APPROVED,
        approvedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      toast.success("Informe aprobado.");
      fetchData();
    } catch (err) {
      console.error(err);
      toast.error("Error al aprobar informe.");
    }
  };

  const handleReject = async (reportId) => {
    const reason = window.prompt("Motivo del rechazo:");
    if (reason === null) return; // Cancelled
    if (!reason.trim()) {
      toast.error("El motivo es obligatorio para rechazar.");
      return;
    }

    try {
      await updateDoc(doc(db, 'reports', reportId), {
        status: REPORT_STATUSES.REJECTED,
        reviewComment: reason.trim(),
        updatedAt: serverTimestamp()
      });
      toast.success("Informe rechazado.");
      fetchData();
    } catch (err) {
      console.error(err);
      toast.error("Error al rechazar informe.");
    }
  };

  const pendingReports = reports.filter(r => r.status === REPORT_STATUSES.SUBMITTED);
  const inProgressReports = reports.filter(r => r.status === REPORT_STATUSES.IN_PROGRESS);
  const historyReports = reports.filter(r => 
    r.status === REPORT_STATUSES.APPROVED || r.status === REPORT_STATUSES.REJECTED
  );

  if (loading) return <Layout title="Bandeja de Informes">Cargando...</Layout>;

  return (
    <Layout title="Bandeja de Informes">
      <div className="space-y-8 max-w-5xl mx-auto">
        
        {/* SECTION 1: Pendientes de asignación */}
        <section className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-800">Pendientes de asignación</h2>
              <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">
                {pendingReports.length}
              </span>
            </div>
            <Link 
              to="/informes/nuevo"
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition-all shadow-sm hover:shadow-md flex items-center gap-2"
            >
              <FileText className="w-3.5 h-3.5" />
              Nuevo Informe Manual
            </Link>
          </div>

          {pendingReports.length === 0 ? (
            <div className="bg-white border border-gray-100 rounded-xl p-8 shadow-sm">
              <EmptyState 
                icon={FileText} 
                title="Sin informes pendientes" 
                description="No hay informes enviados que requieran asignación por ahora." 
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {pendingReports.map(report => (
                <div key={report.id} className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-gray-800">{report.projectName}</span>
                        {report.projectCode && (
                          <span className="text-[10px] font-mono font-bold bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded border border-indigo-100">
                            {report.projectCode}
                          </span>
                        )}
                        {report.recurrence && (
                          <span className="text-[10px] bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded border border-gray-100 uppercase">
                            {report.recurrence}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">
                        Enviado por <span className="font-semibold text-gray-700">{report.authorName}</span> el {report.createdAt?.toDate ? format(report.createdAt.toDate(), "d 'de' MMMM, HH:mm", { locale: es }) : '...'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <select 
                        className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                        value={assigneeSelections[report.id] || ''}
                        onChange={e => setAssigneeSelections(prev => ({ ...prev, [report.id]: e.target.value }))}
                      >
                        <option value="">Seleccionar redactor...</option>
                        {users.map(u => (
                          <option key={u.id} value={u.id}>{u.displayName || u.email}</option>
                        ))}
                      </select>
                      <button 
                        onClick={() => handleAssign(report.id)}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
                      >
                        <User className="w-3.5 h-3.5" />
                        Asignar y comenzar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* SECTION 2: En confección */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 px-1">
            <h2 className="text-lg font-bold text-slate-800">En confección</h2>
            <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-0.5 rounded-full">
              {inProgressReports.length}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {inProgressReports.map(report => (
              <div key={report.id} className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-gray-800">{report.projectName}</span>
                      {report.projectCode && <span className="text-[10px] font-mono text-indigo-400 font-bold">[{report.projectCode}]</span>}
                    </div>
                    <p className="text-xs text-gray-500">
                      Asignado a: <span className="font-semibold text-indigo-600">{report.assignedToName}</span>
                    </p>
                  </div>

                  <div className="flex items-center flex-wrap gap-2">
                    <button 
                      onClick={() => handleToggleApuntes(report.id)}
                      className="text-gray-600 hover:text-gray-900 text-xs font-semibold px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg flex items-center gap-1.5 transition-colors"
                    >
                      {expandedReportId === report.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      Apuntes
                    </button>

                    {report.attachmentURL ? (
                      <a 
                        href={report.attachmentURL} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-indigo-600 hover:text-indigo-800 text-xs font-semibold px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-lg flex items-center gap-1.5 transition-colors"
                      >
                        <ExternalLink className="w-4 h-4" />
                        Ver informe adjunto
                      </a>
                    ) : (
                      <span className="text-gray-400 text-xs italic px-3 py-2">Sin adjunto aún</span>
                    )}

                    <div className="flex items-center gap-2 ml-auto">
                      <button 
                        onClick={() => handleApprove(report.id)}
                        className="text-emerald-600 hover:text-emerald-700 p-1.5 rounded hover:bg-emerald-50 transition-colors"
                        title="Aprobar"
                      >
                        <CheckCircle className="w-6 h-6" />
                      </button>
                      <button 
                        onClick={() => handleReject(report.id)}
                        className="text-red-500 hover:text-red-600 p-1.5 rounded hover:bg-red-50 transition-colors"
                        title="Rechazar"
                      >
                        <XCircle className="w-6 h-6" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded Apuntes */}
                {expandedReportId === report.id && (
                  <div className="bg-gray-50 border-t border-gray-100 p-5 space-y-4">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Apuntes registrados</h4>
                    {loadingApuntes ? (
                      <Loader2 className="w-5 h-5 animate-spin text-gray-300 mx-auto" />
                    ) : !apuntesMap[report.id] || apuntesMap[report.id].length === 0 ? (
                      <p className="text-sm text-gray-400 italic">No hay apuntes disponibles.</p>
                    ) : (
                      <div className="space-y-4">
                        {apuntesMap[report.id].map(apunte => (
                          <div key={apunte.id} className="space-y-1">
                            <div className="flex items-center justify-between text-[10px] text-gray-400">
                              <span className="font-bold">{apunte.authorName}</span>
                              <span>{apunte.createdAt?.toDate ? format(apunte.createdAt.toDate(), "d MMM, HH:mm", { locale: es }) : '...'}</span>
                            </div>
                            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                              {apunte.content}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {inProgressReports.length === 0 && (
              <p className="text-sm text-gray-400 italic text-center py-4">No hay informes en confección actualmente.</p>
            )}
          </div>
        </section>

        {/* SECTION 3: Historial */}
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm transition-all">
          <button 
            onClick={() => setHistoryExpanded(!historyExpanded)}
            className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
          >
            <h2 className="text-lg font-bold text-slate-800">Historial de Revisiones</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 font-medium">({historyReports.length} registros)</span>
              {historyExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
            </div>
          </button>

          {historyExpanded && (
            <div className="overflow-x-auto border-t border-gray-100">
              <table className="w-full text-left">
                <thead className="bg-gray-50 text-xs font-bold text-gray-500 border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-3">Proyecto</th>
                    <th className="px-6 py-3">Recurrencia</th>
                    <th className="px-6 py-3">Autor</th>
                    <th className="px-6 py-3">Estado</th>
                    <th className="px-6 py-3">Fecha</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {historyReports.map(report => (
                    <tr key={report.id} className="hover:bg-gray-50/50">
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-gray-800">{report.projectName}</span>
                          {report.projectCode && <span className="text-[10px] font-mono text-gray-400">{report.projectCode}</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-600 capitalize">{report.recurrence || '—'}</td>
                      <td className="px-6 py-4 text-xs text-gray-600">{report.authorName}</td>
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            report.status === REPORT_STATUSES.APPROVED ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                          }`}>
                            {report.status === REPORT_STATUSES.APPROVED ? 'Aprobado' : 'Rechazado'}
                          </span>
                          {report.status === REPORT_STATUSES.REJECTED && report.reviewComment && (
                            <p className="text-[10px] text-red-500 italic max-w-xs truncate" title={report.reviewComment}>
                              "{report.reviewComment}"
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-500">
                        {report.updatedAt?.toDate ? format(report.updatedAt.toDate(), "d/MM/yy", { locale: es }) : '—'}
                      </td>
                    </tr>
                  ))}
                  {historyReports.length === 0 && (
                    <tr>
                      <td colSpan="5" className="px-6 py-8 text-center text-gray-400 italic text-sm">
                        Sin historial de reportes.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>
    </Layout>
  );
}
