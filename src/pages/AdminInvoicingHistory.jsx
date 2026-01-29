import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { collection, query, orderBy, getDocs, doc, updateDoc, writeBatch, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { formatCurrency } from '../utils/format';
import { Skeleton } from '../components/Skeleton';
import { FileText, CheckCircle, Clock, XCircle, Search, Filter, Ban } from 'lucide-react';

export default function AdminInvoicingHistory() {
  const [invoices, setInvoices] = useState([]);
  const [filteredInvoices, setFilteredInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all, pending, paid, annulled

  useEffect(() => {
    fetchInvoices();
  }, []);

  async function fetchInvoices() {
    try {
      const q = query(collection(db, "invoices"), orderBy("createdAt", "desc"));
      const snapshot = await getDocs(q);
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setInvoices(docs);
    } catch (e) {
      console.error("Error fetching history:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let res = invoices;

    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      res = res.filter(inv => 
        (inv.clientName || '').toLowerCase().includes(lower) ||
        (inv.projectName || '').toLowerCase().includes(lower) || 
        (inv.glosa || '').toLowerCase().includes(lower)
      );
    }

    if (statusFilter !== 'all') {
      res = res.filter(inv => inv.paymentStatus === statusFilter);
    }

    setFilteredInvoices(res);
  }, [invoices, searchTerm, statusFilter]);

  async function updateStatus(id, newStatus) {
     if (newStatus === 'annulled' && !window.confirm("¿Estás seguro de anular esta factura? Se liberarán los gastos asociados para ser facturados nuevamente.")) {
         return;
     }

     try {
         const batch = writeBatch(db);
         const invRef = doc(db, "invoices", id);
         
         // 1. Update Invoice Status
         batch.update(invRef, { paymentStatus: newStatus });

         // 2. If Annulling, Release Expenses
         if (newStatus === 'annulled') {
             const q = query(collection(db, "expenses"), where("invoiceId", "==", id));
             const snapshot = await getDocs(q);
             snapshot.docs.forEach(doc => {
                 batch.update(doc.ref, { invoiceId: null });
             });
         }

         await batch.commit();

         // Update local state
         setInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, paymentStatus: newStatus } : inv));
     } catch (e) {
         console.error("Error updating status:", e);
         alert("Error al actualizar estado");
     }
  }

  const getStatusColor = (status) => {
      switch (status) {
          case 'paid': return 'bg-green-100 text-green-600';
          case 'annulled': return 'bg-red-100 text-red-600';
          default: return 'bg-orange-100 text-orange-600';
      }
  };

  const getStatusText = (status) => {
      switch (status) {
          case 'paid': return 'PAGADO';
          case 'annulled': return 'ANULADA';
          default: return 'PENDIENTE';
      }
  };

  return (
    <Layout title="Historial de Facturación">
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input 
                type="text" 
                placeholder="Buscar por cliente, proyecto o glosa..." 
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
            />
        </div>
        
        <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-500" />
            <select 
                className="p-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
            >
                <option value="all">Todos los Estados</option>
                <option value="pending">Pendiente de Pago</option>
                <option value="paid">Pagado</option>
                <option value="annulled">Anulada</option>
            </select>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
         {loading ? (
             <div className="p-6 space-y-4">
                 {[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
             </div>
         ) : filteredInvoices.length === 0 ? (
             <div className="p-12 text-center text-slate-400">
                 <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
                 <p>No se encontraron facturas.</p>
             </div>
         ) : (
             <div className="divide-y divide-slate-100">
                 {filteredInvoices.map(inv => (
                     <div key={inv.id} className={`p-6 hover:bg-slate-50 transition flex flex-col md:flex-row md:items-center justify-between gap-4 ${inv.paymentStatus === 'annulled' ? 'opacity-60 bg-slate-50' : ''}`}>
                         
                         <div className="flex items-start gap-4">
                             <div className={`p-3 rounded-xl ${getStatusColor(inv.paymentStatus)}`}>
                                 <FileText className="w-6 h-6" />
                             </div>
                             <div>
                                 <h4 className={`font-bold text-slate-800 text-lg ${inv.paymentStatus === 'annulled' ? 'line-through text-slate-500' : ''}`}>
                                    {inv.clientName || 'Cliente desconocido'}
                                 </h4>
                                 <p className="text-sm text-indigo-600 font-medium mb-1">{inv.projectName}</p>
                                 <p className="text-xs text-slate-500">
                                     Emisión: {inv.createdAt?.seconds ? new Date(inv.createdAt.seconds * 1000).toLocaleDateString() : '-'}
                                     {inv.documentType && <span className="uppercase ml-2">• {inv.documentType?.replace('_', ' ')}</span>}
                                 </p>
                                 {inv.glosa && (
                                     <p className="text-xs text-slate-500 italic mt-1 max-w-md truncate">"{inv.glosa}"</p>
                                 )}
                             </div>
                         </div>

                         <div className="flex items-center gap-6 justify-between md:justify-end w-full md:w-auto">
                             <div className="text-right">
                                 <p className={`text-2xl font-extrabold text-slate-800 ${inv.paymentStatus === 'annulled' ? 'line-through text-slate-400' : ''}`}>
                                    {formatCurrency(inv.totalAmount)}
                                 </p>
                                 <p className="text-xs text-slate-500">{inv.itemCount} items</p>
                             </div>

                             <div className="flex gap-2">
                                 {inv.paymentStatus !== 'annulled' && (
                                     <>
                                        {inv.paymentStatus === 'paid' ? (
                                            <button 
                                                onClick={() => updateStatus(inv.id, 'pending')}
                                                className="flex items-center gap-1 px-3 py-1.5 bg-green-100 text-green-700 rounded-lg text-xs font-bold hover:bg-green-200"
                                                title="Marcar como Pendiente"
                                            >
                                                <CheckCircle className="w-3 h-3" /> PAGADO
                                            </button>
                                        ) : (
                                            <button 
                                                onClick={() => updateStatus(inv.id, 'paid')}
                                                className="flex items-center gap-1 px-3 py-1.5 bg-orange-100 text-orange-700 rounded-lg text-xs font-bold hover:bg-orange-200"
                                                title="Marcar como Pagado"
                                            >
                                                <Clock className="w-3 h-3" /> PENDIENTE
                                            </button>
                                        )}
                                        
                                        <button 
                                            onClick={() => updateStatus(inv.id, 'annulled')}
                                            className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-bold hover:bg-red-100"
                                            title="Anular Factura"
                                        >
                                            <Ban className="w-3 h-3" /> ANULAR
                                        </button>
                                     </>
                                 )}
                                 
                                 {inv.paymentStatus === 'annulled' && (
                                     <span className="px-3 py-1.5 bg-slate-200 text-slate-500 rounded-lg text-xs font-bold">
                                         ANULADA
                                     </span>
                                 )}
                             </div>
                         </div>

                     </div>
                 ))}
             </div>
         )}
      </div>
    </Layout>
  );
}
