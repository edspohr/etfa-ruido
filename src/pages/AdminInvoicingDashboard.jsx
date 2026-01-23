import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { FileText, Plus, CheckCircle, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { formatCurrency } from '../utils/format';
import { Skeleton } from '../components/Skeleton';

export default function AdminInvoicingDashboard() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
     async function fetchInvoices() {
         try {
             // Order by createdAt desc
             const q = query(collection(db, "invoices"), orderBy("createdAt", "desc"));
             const querySnap = await getDocs(q);
             const docs = querySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
             setInvoices(docs);
         } catch (e) {
             console.error("Error fetching invoices:", e);
         } finally {
             setLoading(false);
         }
     }
     fetchInvoices();
  }, []);

  const totalPreInvoices = invoices.reduce((sum, inv) => sum + (Number(inv.totalAmount) || 0), 0);
  // Assuming "Pre-Factura" means status='draft'. 
  // If we had a "Billed" status, we would separate them.
  // For now, let's treat all generated items as "Pre-Facturas".

  return (
    <Layout title="Facturación - Dashboard">
      <div className="flex justify-end mb-6">
        <Link 
          to="/admin/invoicing/generate" 
          className="flex items-center bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4 mr-2" />
          Nueva Pre-Factura
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100">
           <h3 className="text-slate-500 text-sm font-semibold uppercase tracking-wide">Total Pre-Facturado</h3>
           <p className="text-3xl font-extrabold text-slate-800 mt-2">{formatCurrency(totalPreInvoices)}</p>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100">
           <h3 className="text-slate-500 text-sm font-semibold uppercase tracking-wide">Cantidad</h3>
           <p className="text-3xl font-extrabold text-indigo-600 mt-2">{invoices.length}</p>
        </div>
        {/* Placeholder for future metric */}
        <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100 opacity-50">
           <h3 className="text-slate-500 text-sm font-semibold uppercase tracking-wide">Facturado (Mes)</h3>
           <p className="text-3xl font-extrabold text-slate-400 mt-2">$0</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100">
            <h3 className="font-bold text-lg text-slate-800">Pre-Facturas Recientes</h3>
        </div>
        
        {loading ? (
             <div className="p-6 space-y-4">
                 <Skeleton className="h-12 w-full" />
                 <Skeleton className="h-12 w-full" />
             </div>
        ) : invoices.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p>No hay pre-facturas generadas aún.</p>
            </div>
        ) : (
            <div className="divide-y divide-slate-100">
                {invoices.map(invoice => (
                    <div key={invoice.id} className="p-6 flex items-center justify-between hover:bg-slate-50 transition">
                        <div className="flex items-center gap-4">
                            <div className="bg-indigo-100 p-2 rounded-lg text-indigo-600">
                                <FileText className="w-6 h-6" />
                            </div>
                            <div>
                                <h4 className="font-bold text-slate-800">{invoice.clientName}</h4>
                                <p className="text-sm text-slate-500">
                                    {invoice.createdAt?.seconds 
                                        ? new Date(invoice.createdAt.seconds * 1000).toLocaleDateString() 
                                        : 'Fecha desconocida'} • {invoice.count} Gastos
                                </p>
                            </div>
                        </div>
                        <div className="text-right">
                             <p className="font-bold text-slate-800 text-lg">{formatCurrency(invoice.totalAmount)}</p>
                             <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full uppercase tracking-wider">
                                 {invoice.status}
                             </span>
                        </div>
                    </div>
                ))}
            </div>
        )}
      </div>
    </Layout>
  );
}
