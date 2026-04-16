import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs, getDoc, deleteDoc, doc } from 'firebase/firestore';
import { formatCurrency, formatProjectLabel } from '../utils/format';
import { sortProjects } from '../utils/sort';
import { isOlderThan60Days } from '../utils/dateUtils';
import ProjectBitacora from '../components/ProjectBitacora';
import {
  FileText, Wallet, User, ChevronDown, ChevronUp,
  Trash2, Copy, PlusCircle, MessageSquare, Download,
} from 'lucide-react';
import { toast } from 'sonner';

export default function UserExpenses() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();

  const [userData, setUserData] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [projectsList, setProjectsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedProject, setExpandedProject] = useState(null);
  const [showHistorical, setShowHistorical] = useState(false);

  const [bitacoraOpen, setBitacoraOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [csvFrom, setCsvFrom] = useState('');
  const [csvTo, setCsvTo] = useState('');

  const toggleProject = (pid) => {
    setExpandedProject(prev => prev === pid ? null : pid);
  };

  const openBitacora = (e, projectId) => {
    e.stopPropagation();
    setSelectedProjectId(projectId);
    setBitacoraOpen(true);
  };

  const fetchData = useCallback(async () => {
    if (!currentUser) return;
    try {
      setLoading(true);

      // 1. User document
      const uSnap = await getDoc(doc(db, 'users', currentUser.uid));
      if (uSnap.exists()) setUserData({ id: uSnap.id, ...uSnap.data() });

      // 2. Expenses
      const expSnap = await getDocs(
        query(collection(db, 'expenses'), where('userId', '==', currentUser.uid))
      );
      const expData = expSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => new Date(b.date) - new Date(a.date));
      setExpenses(expData);

      // 3. Allocations
      const allocSnap = await getDocs(
        query(collection(db, 'allocations'), where('userId', '==', currentUser.uid))
      );
      const allocData = allocSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => new Date(b.date) - new Date(a.date));
      setAllocations(allocData);

      // 4. Projects
      const pSnap = await getDocs(collection(db, 'projects'));
      setProjectsList(pSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Error fetching expenses:', err);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDownloadCSV = () => {
    const fromDate = csvFrom ? new Date(csvFrom + 'T00:00:00') : null;
    const toDate   = csvTo   ? new Date(csvTo   + 'T23:59:59') : null;

    const inRange = (dateStr) => {
      if (!dateStr) return true;
      const d = new Date(dateStr);
      if (fromDate && d < fromDate) return false;
      if (toDate   && d > toDate)   return false;
      return true;
    };

    const headers = ['Fecha', 'Tipo', 'Proyecto', 'Código', 'Recurrencia', 'Descripción', 'Categoría', 'Monto', 'Estado', 'Motivo Rechazo'];

    const rows = [];

    allocations.filter(a => inRange(a.date ? a.date.split('T')[0] : '')).forEach(a => {
      const meta = projectsList.find(p => p.id === a.projectId);
      let csvDesc = 'Asignación de viático';
      if (a.type === 'transfer_out') {
        csvDesc = `Reasignación a ${a.transferTargetProjectCode ? `[${a.transferTargetProjectCode}] ` : ''}${a.transferTargetProjectName || 'otro proyecto'}`;
      } else if (a.type === 'transfer_in') {
        csvDesc = `Reasignación desde ${a.transferSourceProjectCode ? `[${a.transferSourceProjectCode}] ` : ''}${a.transferSourceProjectName || 'otro proyecto'}`;
      }
      rows.push([
        a.date ? a.date.split('T')[0] : '',
        'Viático',
        a.projectName || '',
        meta?.code || '',
        meta?.recurrence || '',
        `"${csvDesc}"`,
        '-',
        a.amount || 0,
        '-',
        '-',
      ]);
    });

    expenses.filter(e => inRange(e.date)).forEach(e => {
      const meta = projectsList.find(p => p.id === e.projectId);
      rows.push([
        e.date || '',
        'Rendición',
        e.projectName || '',
        meta?.code || '',
        meta?.recurrence || e.projectRecurrence || '',
        `"${(e.description || '').replace(/"/g, '""')}"`,
        e.category || '',
        e.amount || 0,
        e.status === 'approved' ? 'Aprobado' : e.status === 'rejected' ? 'Rechazado' : 'Pendiente',
        `"${(e.rejectionReason || '').replace(/"/g, '""')}"`,
      ]);
    });

    rows.sort((a, b) => (b[0] > a[0] ? 1 : -1));

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = (userData?.displayName || 'usuario').replace(/\s+/g, '_');
    const suffix = csvFrom && csvTo ? `${csvFrom}_al_${csvTo}` : 'completo';
    link.setAttribute('href', url);
    link.setAttribute('download', `rendiciones_${safeName}_${suffix}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDelete = async (expense) => {
    if (!confirm('¿Eliminar esta rendición pendiente?')) return;
    try {
      await deleteDoc(doc(db, 'expenses', expense.id));
      setExpenses(prev => prev.filter(e => e.id !== expense.id));
      toast.success('Rendición eliminada.');
    } catch (err) {
      console.error('Error deleting expense:', err);
      toast.error('Error al eliminar.');
    }
  };

  if (loading) return <Layout title="Mis Rendiciones">Cargando...</Layout>;

  const balance = userData?.balance ?? 0;

  const approvedCount = expenses.filter(e => e.status === 'approved').length;
  const rejectedCount = expenses.filter(e => e.status === 'rejected').length;

  return (
    <Layout title="Mis Rendiciones">
      {/* Top actions */}
      <div className="flex flex-wrap justify-end items-center gap-3 mb-6">
        <div className="flex items-center gap-1">
          <label className="text-xs text-gray-500 font-medium">Desde</label>
          <input type="date" value={csvFrom} onChange={e => setCsvFrom(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-xs" />
        </div>
        <div className="flex items-center gap-1">
          <label className="text-xs text-gray-500 font-medium">Hasta</label>
          <input type="date" value={csvTo} onChange={e => setCsvTo(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-xs" />
        </div>
        <button
          onClick={handleDownloadCSV}
          className="bg-gray-800 text-white px-3 py-2 rounded-xl hover:bg-gray-700 text-sm font-bold transition-all flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          CSV
        </button>
        <Link
          to="/dashboard/new-expense"
          className="bg-green-600 text-white px-4 py-2 rounded-xl hover:bg-green-700 text-sm font-bold shadow-md transition-all flex items-center gap-2"
        >
          <PlusCircle className="w-4 h-4" />
          Nueva Rendición
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Info Card */}
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex items-center">
          <div className="mr-4 bg-gray-100 p-3 rounded-full">
            <User className="w-8 h-8 text-gray-500" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-500 mb-1">Información</h3>
            <p className="text-lg font-bold text-gray-800">
              {userData?.displayName} {userData?.code ? `[${userData.code}]` : ''}
            </p>
            <p className="text-sm text-gray-500">{userData?.email}</p>
            <p className="text-sm text-gray-500 capitalize">{userData?.role}</p>
          </div>
        </div>

        {/* Balance Card */}
        <div className="bg-gradient-to-br from-blue-600 to-blue-800 p-6 rounded-lg shadow-sm border border-blue-500 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Wallet className="w-16 h-16" />
          </div>
          <div className="relative z-10">
            <h3 className="text-blue-100 text-sm font-medium mb-1">Saldo Actual (Viático)</h3>
            <p className="text-3xl font-bold">{formatCurrency(balance)}</p>
            <p className="text-blue-200 text-xs mt-1">
              {balance < 0 ? 'Fondos por Rendir' : 'Saldo a Favor'}
            </p>
          </div>
        </div>
      </div>

      {/* Summary line + 60-day toggle */}
      <div className="flex flex-wrap justify-between items-center mb-4 gap-2">
        {(approvedCount > 0 || rejectedCount > 0) && (
          <p className="text-sm text-gray-500">
            Tienes{' '}
            <span className="font-bold text-emerald-600">{approvedCount} aprobadas</span>
            {' '}y{' '}
            <span className="font-bold text-rose-600">{rejectedCount} rechazadas</span>
          </p>
        )}
        <button
          onClick={() => setShowHistorical(prev => !prev)}
          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline transition-colors ml-auto"
        >
          {showHistorical ? 'Ocultar registros antiguos' : 'Mostrar registros anteriores a 60 días'}
        </button>
      </div>

      {/* Resumen por Proyecto */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b bg-gray-50">
          <h3 className="font-bold text-gray-700 flex items-center">
            <FileText className="w-5 h-5 mr-2 text-gray-400" />
            Resumen por Proyecto
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-white">
              <tr className="border-b">
                <th className="px-6 py-3 font-medium text-gray-500">Proyecto</th>
                <th className="px-6 py-3 font-medium text-gray-500 text-right">Total Viáticos</th>
                <th className="px-6 py-3 font-medium text-gray-500 text-right">Total Rendido</th>
                <th className="px-6 py-3 font-medium text-gray-500 text-right">Saldo</th>
                <th className="px-6 py-3 font-medium text-gray-500 text-right">Estado</th>
                <th className="px-6 py-3 font-medium text-gray-500 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(() => {
                // Aggregate — only approved expenses count toward totals
                const projectStats = {};

                expenses.forEach(e => {
                  if (e.status !== 'approved') return;
                  const pid = e.projectId || 'unknown';
                  if (!projectStats[pid]) projectStats[pid] = { totalExp: 0, totalAlloc: 0, name: e.projectName || 'Sin Proyecto' };
                  projectStats[pid].totalExp += (Number(e.amount) || 0);
                  if (e.projectName) projectStats[pid].name = e.projectName;
                });

                allocations.forEach(a => {
                  const pid = a.projectId || 'unknown';
                  if (!projectStats[pid]) projectStats[pid] = { totalExp: 0, totalAlloc: 0, name: a.projectName || 'Sin Proyecto' };
                  projectStats[pid].totalAlloc += (Number(a.amount) || 0);
                });

                // Also surface projects that only have non-approved expenses (pending/rejected)
                expenses.forEach(e => {
                  if (e.status === 'approved') return;
                  const pid = e.projectId || 'unknown';
                  if (!projectStats[pid]) {
                    projectStats[pid] = { totalExp: 0, totalAlloc: 0, name: e.projectName || 'Sin Proyecto' };
                  }
                });

                let rows = Object.entries(projectStats).map(([pid, stats]) => {
                  const meta = projectsList.find(p => p.id === pid);
                  return {
                    id: pid,
                    name: meta ? meta.name : stats.name,
                    code: meta ? meta.code : '',
                    recurrence: meta ? meta.recurrence : '',
                    ...stats
                  };
                });

                rows = sortProjects(rows);

                if (rows.length === 0) {
                  return (
                    <tr>
                      <td colSpan="6" className="p-8 text-center text-gray-400">No hay actividad registrada.</td>
                    </tr>
                  );
                }

                return rows.map(row => {
                  const isExpanded = expandedProject === row.id;

                  // For expanded detail, respect 60-day filter
                  const projectExpenses = expenses.filter(e =>
                    (e.projectId === row.id || (!e.projectId && row.id === 'unknown')) &&
                    (showHistorical || !isOlderThan60Days(e.date))
                  );
                  const projectAllocations = allocations.filter(a =>
                    (a.projectId === row.id || (!a.projectId && row.id === 'unknown')) &&
                    (showHistorical || !isOlderThan60Days(a.date))
                  );

                  return (
                    <React.Fragment key={row.id}>
                      <tr
                        className={`hover:bg-gray-50 transition cursor-pointer ${isExpanded ? 'bg-gray-50' : ''}`}
                        onClick={() => toggleProject(row.id)}
                      >
                        <td className="px-6 py-4">
                          <span className="font-medium text-gray-800">
                            {formatProjectLabel(row)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-green-600">
                          {formatCurrency(row.totalAlloc)}
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-blue-600">
                          {formatCurrency(row.totalExp)}
                        </td>
                        <td className={`px-6 py-4 text-right font-bold ${row.totalExp - row.totalAlloc >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
                          {formatCurrency(row.totalExp - row.totalAlloc)}
                        </td>
                        <td className="px-6 py-4 text-right">
                          {row.totalAlloc > row.totalExp ? (
                            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full border bg-emerald-100 text-emerald-700 border-emerald-200">
                              En Rango
                            </span>
                          ) : row.totalExp > row.totalAlloc ? (
                            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full border bg-amber-100 text-amber-700 border-amber-200">
                              ⚠️ Excedido
                            </span>
                          ) : (
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right flex items-center justify-end gap-3 text-gray-400">
                          <button
                            onClick={(e) => openBitacora(e, row.id)}
                            className="text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 p-2 rounded-full transition-colors"
                            title="Ver comentarios del proyecto"
                          >
                            <MessageSquare className="w-5 h-5 pointer-events-none" />
                          </button>
                          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr>
                          <td colSpan="6" className="bg-gray-50 px-6 py-4">
                            <div className="flex flex-col lg:flex-row gap-8 pl-4 border-l-2 border-blue-200">

                              {/* Viáticos Asignados */}
                              <div className="flex-1">
                                <h4 className="font-semibold text-gray-600 mb-2 flex items-center text-xs uppercase tracking-wider">
                                  <Wallet className="w-4 h-4 mr-2" /> Viáticos Asignados
                                </h4>
                                {projectAllocations.length === 0 ? (
                                  <p className="text-xs text-gray-400 italic">Sin registros</p>
                                ) : (
                                  <div className="bg-white rounded border border-gray-100 overflow-hidden">
                                    <table className="w-full text-xs">
                                      <tbody>
                                        {projectAllocations.map(a => (
                                          <tr key={a.id} className="border-b last:border-0">
                                            <td className="px-3 py-2 text-gray-500">
                                              <p>{new Date(a.date).toLocaleDateString()}</p>
                                              {a.type === 'transfer_out' && (
                                                <p className="text-xs text-rose-500">→ Reasignado a {a.transferTargetProjectCode ? `[${a.transferTargetProjectCode}] ` : ''}{a.transferTargetProjectName || 'otro proyecto'}</p>
                                              )}
                                              {a.type === 'transfer_in' && (
                                                <p className="text-xs text-emerald-500">← Desde {a.transferSourceProjectCode ? `[${a.transferSourceProjectCode}] ` : ''}{a.transferSourceProjectName || 'otro proyecto'}</p>
                                              )}
                                            </td>
                                            <td className="px-3 py-2 font-medium text-right text-green-700">{formatCurrency(a.amount)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>

                              {/* Rendiciones */}
                              <div className="flex-[2]">
                                <h4 className="font-semibold text-gray-600 mb-2 flex items-center text-xs uppercase tracking-wider">
                                  <FileText className="w-4 h-4 mr-2" /> Mis Rendiciones
                                </h4>
                                {projectExpenses.length === 0 ? (
                                  <p className="text-xs text-gray-400 italic">Sin registros</p>
                                ) : (
                                  <div className="bg-white rounded border border-gray-100 overflow-hidden">
                                    <table className="w-full text-xs">
                                      <thead className="bg-gray-50">
                                        <tr>
                                          <th className="px-3 py-2 text-left">Fecha</th>
                                          <th className="px-3 py-2 text-left">Detalle</th>
                                          <th className="px-3 py-2 text-right">Monto</th>
                                          <th className="px-3 py-2 text-center">Estado</th>
                                          <th className="px-3 py-2 text-center">Acciones</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {projectExpenses.map(e => (
                                          <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                                            <td className="px-3 py-2 text-gray-500 w-24">{e.date}</td>
                                            <td className="px-3 py-2">
                                              <p className="font-medium text-gray-700">{e.category}</p>
                                              <p className="text-gray-400 truncate max-w-[150px]">{e.description}</p>
                                              {e.imageUrl && (
                                                <a href={e.imageUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Ver Boleta</a>
                                              )}
                                            </td>
                                            <td className={`px-3 py-2 font-bold text-right ${e.status === 'rejected' ? 'line-through text-slate-400' : 'text-gray-700'}`}>
                                              {formatCurrency(e.amount)}
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                              <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                                                e.status === 'approved' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                                                e.status === 'rejected' ? 'bg-rose-100 text-rose-700 border-rose-200' :
                                                'bg-amber-100 text-amber-700 border-amber-200'
                                              }`}>
                                                {e.status === 'approved' ? 'Aprobado' : e.status === 'rejected' ? 'Rechazado' : 'Pendiente'}
                                              </span>
                                              {e.rejectionReason && (
                                                <p className="text-xs italic text-slate-400 mt-1">Motivo: {e.rejectionReason}</p>
                                              )}
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                              <div className="flex justify-center gap-1">
                                                <button
                                                  onClick={() => navigate('/dashboard/new-expense', { state: { duplicate: e } })}
                                                  className="p-1 text-gray-400 hover:text-blue-500 rounded"
                                                  title="Duplicar Rendición"
                                                >
                                                  <Copy className="w-4 h-4" />
                                                </button>
                                                {e.status === 'pending' && (
                                                  <button
                                                    onClick={() => handleDelete(e)}
                                                    className="p-1 text-gray-400 hover:text-red-500 rounded"
                                                    title="Eliminar Rendición"
                                                  >
                                                    <Trash2 className="w-4 h-4" />
                                                  </button>
                                                )}
                                              </div>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>

                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {selectedProjectId && (
        <ProjectBitacora
          projectId={selectedProjectId}
          isOpen={bitacoraOpen}
          onClose={() => {
            setBitacoraOpen(false);
            setSelectedProjectId(null);
          }}
        />
      )}
    </Layout>
  );
}
