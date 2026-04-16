import { useState, useEffect, useMemo } from 'react';
import Layout from '../components/Layout';
import { collection, query, orderBy, getDocs, doc, writeBatch, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { formatCurrency } from '../utils/format';
import { Skeleton } from '../components/Skeleton';
import { FileText, CheckCircle, Clock, XCircle, Search, Filter, Ban, Download, Calendar, ArrowUpDown } from 'lucide-react';
import InvoiceDetailModal from '../components/InvoiceDetailModal';
import { toast } from 'sonner';

export default function AdminInvoicingHistory() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [sortField, setSortField] = useState('date'); // date | amount | client
  const [sortDir, setSortDir] = useState('desc');

  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => { fetchInvoices(); }, []);

  async function fetchInvoices() {
    try {
      const q = query(collection(db, "invoices"), orderBy("createdAt", "desc"));
      const snapshot = await getDocs(q);
      setInvoices(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Error fetching history:", e);
      toast.error("Error cargando historial.");
    } finally {
      setLoading(false);
    }
  }

  const filteredInvoices = useMemo(() => {
    let res = [...invoices];

    // Status filter
    if (statusFilter !== 'all') {
      res = res.filter(inv => inv.paymentStatus === statusFilter);
    }

    // Search filter
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      res = res.filter(inv => 
        (inv.clientName || '').toLowerCase().includes(lower) ||
        (inv.projectName || '').toLowerCase().includes(lower) || 
        (inv.glosa || '').toLowerCase().includes(lower) ||
        (inv.clientRut || '').toLowerCase().includes(lower)
      );
    }

    // Date range filter
    if (dateRange.from || dateRange.to) {
      res = res.filter(inv => {
        const invDate = inv.issueDate
          ? new Date(inv.issueDate + 'T00:00:00')
          : inv.createdAt?.seconds ? new Date(inv.createdAt.seconds * 1000) : null;
        if (!invDate) return true;
        if (dateRange.from && invDate < new Date(dateRange.from + 'T00:00:00')) return false;
        if (dateRange.to && invDate > new Date(dateRange.to + 'T23:59:59')) return false;
        return true;
      });
    }

    // Sort
    res.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'date') {
        const dA = a.issueDate || (a.createdAt?.seconds ? new Date(a.createdAt.seconds * 1000).toISOString().split('T')[0] : '');
        const dB = b.issueDate || (b.createdAt?.seconds ? new Date(b.createdAt.seconds * 1000).toISOString().split('T')[0] : '');
        cmp = dA.localeCompare(dB);
      } else if (sortField === 'amount') {
        cmp = (Number(a.totalAmount) || 0) - (Number(b.totalAmount) || 0);
      } else if (sortField === 'client') {
        cmp = (a.clientName || '').localeCompare(b.clientName || '');
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return res;
  }, [invoices, searchTerm, statusFilter, dateRange, sortField, sortDir]);

  // Summary stats
  const stats = useMemo(() => {
    const active = invoices.filter(i => i.status !== 'void');
    return {
      total: active.reduce((s, i) => s + (Number(i.totalAmount) || 0), 0),
      paid: active.filter(i => i.paymentStatus === 'paid').reduce((s, i) => s + (Number(i.totalAmount) || 0), 0),
      pending: active.filter(i => i.paymentStatus === 'pending').reduce((s, i) => s + (Number(i.totalAmount) || 0), 0),
      count: active.length,
      voidCount: invoices.filter(i => i.status === 'void').length,
    };
  }, [invoices]);

  async function updateStatus(id, newStatus) {
    if (newStatus === 'void' && !window.confirm("¿Anular esta factura? Se liberarán los gastos.")) return;

    try {
      const batch = writeBatch(db);
      const invRef = doc(db, "invoices", id);
      
      const updatePayload = { paymentStatus: newStatus };
      if (newStatus === 'void') updatePayload.status = 'void';
      batch.update(invRef, updatePayload);

      if (newStatus === 'void') {
        const q = query(collection(db, "expenses"), where("invoiceId", "==", id));
        const snapshot = await getDocs(q);
        snapshot.docs.forEach(doc => {
          batch.update(doc.ref, { invoiceId: null, invoiceStatus: 'approved' });
        });
      }

      await batch.commit();
      setInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, ...updatePayload } : inv));
      toast.success(newStatus === 'paid' ? 'Marcada como pagada' : newStatus === 'void' ? 'Factura anulada' : 'Estado actualizado');
    } catch (e) {
      console.error("Error:", e);
      toast.error("Error al actualizar");
    }
  }

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  // CSV Export
  const handleExportCSV = () => {
    const headers = ['Fecha', 'Cliente', 'RUT', 'Proyecto', 'Monto Neto', 'Estado Pago', 'Tipo Doc'];
    const rows = filteredInvoices.map(inv => [
      inv.createdAt?.seconds ? new Date(inv.createdAt.seconds * 1000).toLocaleDateString() : '',
      `"${(inv.clientName || '').replace(/"/g, '""')}"`,
      inv.clientRut || '',
      `"${(inv.projectName || '').replace(/"/g, '""')}"`,
      inv.totalAmount || 0,
      inv.paymentStatus === 'paid' ? 'Pagado' : inv.paymentStatus === 'void' ? 'Anulada' : 'Pendiente',
      inv.documentType || 'factura'
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `facturas_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  return (
    <Layout title="Historial de Facturación">
      {/* Summary Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
          <p className="text-[10px] font-bold text-slate-500 uppercase">Total Facturado</p>
          <p className="text-xl font-black text-slate-900">{formatCurrency(stats.total)}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-emerald-100 shadow-sm">
          <p className="text-[10px] font-bold text-emerald-600 uppercase">Recaudado</p>
          <p className="text-xl font-black text-emerald-700">{formatCurrency(stats.paid)}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-amber-100 shadow-sm">
          <p className="text-[10px] font-bold text-amber-600 uppercase">Pendiente</p>
          <p className="text-xl font-black text-amber-700">{formatCurrency(stats.pending)}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
          <p className="text-[10px] font-bold text-slate-500 uppercase">Documentos</p>
          <p className="text-xl font-black text-slate-900">{stats.count} <span className="text-sm font-normal text-slate-400">({stats.voidCount} anuladas)</span></p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input 
              type="text" 
              placeholder="Buscar cliente, proyecto, RUT..." 
              className="pl-10 pr-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm w-64"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          
          <select 
            className="p-2 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="all">Todos</option>
            <option value="pending">Pendiente</option>
            <option value="paid">Pagado</option>
            <option value="void">Anulada</option>
          </select>

          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-400" />
            <input type="date" value={dateRange.from} onChange={e => setDateRange({...dateRange, from: e.target.value})} className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs" />
            <span className="text-slate-400 text-xs">a</span>
            <input type="date" value={dateRange.to} onChange={e => setDateRange({...dateRange, to: e.target.value})} className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs" />
          </div>
        </div>

        <button onClick={handleExportCSV} className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-slate-700 transition shadow-sm">
          <Download className="w-4 h-4" /> Exportar CSV
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : filteredInvoices.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p>No se encontraron facturas.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left cursor-pointer hover:text-slate-700" onClick={() => toggleSort('date')}>
                    <span className="flex items-center gap-1">Fecha Factura <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="px-4 py-3 text-left cursor-pointer hover:text-slate-700" onClick={() => toggleSort('client')}>
                    <span className="flex items-center gap-1">Cliente <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="px-4 py-3 text-left">Proyecto</th>
                  <th className="px-4 py-3 text-right">Gastos</th>
                  <th className="px-4 py-3 text-right cursor-pointer hover:text-slate-700" onClick={() => toggleSort('amount')}>
                    <span className="flex items-center gap-1 justify-end">Monto Neto <ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="px-4 py-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredInvoices.map(inv => (
                  <tr 
                    key={inv.id}
                    className={`hover:bg-slate-50 transition cursor-pointer ${inv.paymentStatus === 'void' ? 'opacity-50 bg-slate-50' : ''}`}
                    onClick={() => { setSelectedInvoice(inv); setIsModalOpen(true); }}
                  >
                    <td className="px-4 py-3 text-slate-600 text-xs">
                      {inv.issueDate
                        ? (() => { const [y,m,d] = inv.issueDate.split('-'); return `${d}/${m}/${y}`; })()
                        : inv.createdAt?.seconds ? new Date(inv.createdAt.seconds * 1000).toLocaleDateString('es-CL') : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <p className={`font-bold text-slate-800 text-sm ${inv.paymentStatus === 'void' ? 'line-through' : ''}`}>{inv.clientName || '-'}</p>
                      {inv.clientRut && <p className="text-[10px] text-slate-400 font-mono">{inv.clientRut}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {inv.projectCode && (
                        <span className="text-[10px] font-mono font-bold bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded border border-indigo-100 mr-1">{inv.projectCode}</span>
                      )}
                      <p className="text-indigo-600 text-xs font-medium truncate max-w-[200px]">{inv.projectName || '-'}</p>
                      {inv.documentType && <p className="text-[10px] text-slate-400 capitalize mt-0.5">{inv.documentType.replace('_', ' ')}</p>}
                    </td>
                    <td className="px-4 py-3 text-right text-xs">
                      {inv.totalExpenses ? (
                        <span className="font-mono text-slate-600">{formatCurrency(inv.totalExpenses)}</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-right font-bold ${inv.paymentStatus === 'void' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                      {formatCurrency(inv.totalAmount)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={inv.paymentStatus} />
                    </td>
                    <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                      <div className="flex justify-center gap-1">
                        {inv.paymentStatus !== 'void' && (
                          <>
                            {inv.paymentStatus === 'paid' ? (
                              <button onClick={() => updateStatus(inv.id, 'pending')} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition" title="Revertir a Pendiente">
                                <CheckCircle className="w-4 h-4" />
                              </button>
                            ) : (
                              <button onClick={() => updateStatus(inv.id, 'paid')} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg transition" title="Marcar como Pagada">
                                <Clock className="w-4 h-4" />
                              </button>
                            )}
                            <button onClick={() => updateStatus(inv.id, 'void')} className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition" title="Anular">
                              <Ban className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Results count */}
        {!loading && filteredInvoices.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500">
            Mostrando {filteredInvoices.length} de {invoices.length} documentos
          </div>
        )}
      </div>

      <InvoiceDetailModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        invoice={selectedInvoice}
        onUpdate={fetchInvoices}
      />
    </Layout>
  );
}

function StatusBadge({ status }) {
  const config = {
    paid:    { label: 'Pagado',    cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    pending: { label: 'Pendiente', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    void:    { label: 'Anulada',   cls: 'bg-rose-100 text-rose-700 border-rose-200' },
  };
  const { label, cls } = config[status] || config.pending;
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${cls}`}>
      {label}
    </span>
  );
}
