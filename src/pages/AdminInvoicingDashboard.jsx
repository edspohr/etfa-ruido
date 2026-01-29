import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { FileText, Plus, CheckCircle, Search, TrendingUp, DollarSign, BarChart3, Upload } from 'lucide-react';
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

  // Calculate Metrics
  const metrics = invoices.reduce((acc, inv) => {
      const amount = Number(inv.totalAmount) || 0;
      acc.totalBilled += amount;
      
      if (inv.paymentStatus === 'paid') {
          acc.totalCollected += amount;
      } else {
          acc.pendingCollection += amount;
      }
      return acc;
  }, { totalBilled: 0, totalCollected: 0, pendingCollection: 0 });

  // Calculate Monthly Data
  const monthlyData = invoices.reduce((acc, inv) => {
      if (!inv.createdAt?.seconds) return acc;
      const date = new Date(inv.createdAt.seconds * 1000);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!acc[key]) acc[key] = { billed: 0, collected: 0 };
      
      const amount = Number(inv.totalAmount) || 0;
      acc[key].billed += amount;
      if (inv.paymentStatus === 'paid') {
          acc[key].collected += amount;
      }
      return acc;
  }, {});

  const chartData = Object.keys(monthlyData).sort().map(key => {
      const [y, m] = key.split('-');
      const date = new Date(y, m - 1);
      const monthName = date.toLocaleString('es-ES', { month: 'short' });
      return {
          month: `${monthName} ${y}`,
          ...monthlyData[key]
      };
  });

  return (
    <Layout title="Facturación - Dashboard & Reportes">
      <div className="flex justify-end mb-6 gap-3">
        <Link 
          to="/admin/invoicing/reconciliation" 
          className="flex items-center bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg font-medium hover:bg-slate-50 transition-colors shadow-sm"
        >
          <Upload className="w-4 h-4 mr-2" />
          Conciliación
        </Link>
        <Link 
          to="/admin/invoicing/generate" 
          className="flex items-center bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4 mr-2" />
          Nueva Pre-Factura
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100 flex items-center justify-between">
              <div>
                  <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Total Facturado</p>
                  <p className="text-3xl font-extrabold text-blue-600">{formatCurrency(metrics.totalBilled)}</p>
              </div>
              <div className="bg-blue-50 p-3 rounded-full text-blue-600">
                  <BarChart3 className="w-6 h-6" />
              </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100 flex items-center justify-between">
              <div>
                  <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Total Recaudado</p>
                  <p className="text-3xl font-extrabold text-green-500">{formatCurrency(metrics.totalCollected)}</p>
              </div>
              <div className="bg-green-50 p-3 rounded-full text-green-500">
                  <DollarSign className="w-6 h-6" />
              </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100 flex items-center justify-between">
              <div>
                  <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Pendiente de Cobro</p>
                  <p className="text-3xl font-extrabold text-orange-500">{formatCurrency(metrics.pendingCollection)}</p>
              </div>
              <div className="bg-orange-50 p-3 rounded-full text-orange-500">
                  <TrendingUp className="w-6 h-6" />
              </div>
          </div>
      </div>

      {/* Monthly Chart (CSS Only) */}
      <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100 mb-8">
          <h3 className="font-bold text-slate-800 mb-6">Facturación vs Recaudación (Mensual)</h3>
          
          {loading ? (
              <Skeleton className="h-64 w-full" />
          ) : chartData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-slate-400">
                  No hay datos suficientes para mostrar el gráfico.
              </div>
          ) : (
              <div className="relative h-64 flex items-end gap-4 mt-8 pb-6 border-b border-slate-200">
                   {chartData.map((item, idx) => {
                       const maxVal = Math.max(...chartData.map(d => Math.max(d.billed, d.collected))) || 1;
                       const billedH = (item.billed / maxVal) * 100;
                       const collectedH = (item.collected / maxVal) * 100;
                       
                       return (
                           <div key={idx} className="flex-1 flex flex-col items-center gap-1 h-full justify-end group">
                               <div className="w-full flex gap-1 justify-center items-end h-full">
                                    {/* Billed Bar */}
                                    <div 
                                        className="w-1/3 bg-blue-500 rounded-t-lg transition-all duration-500 relative group"
                                        style={{ height: `${billedH}%`, minHeight: '4px' }}
                                    >
                                        <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 bg-slate-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap z-10 pointer-events-none">
                                            Fact: {formatCurrency(item.billed)}
                                        </div>
                                    </div>
                                    {/* Collected Bar */}
                                    <div 
                                        className="w-1/3 bg-green-500 rounded-t-lg transition-all duration-500 relative group"
                                        style={{ height: `${collectedH}%`, minHeight: '4px' }}
                                    >
                                        <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 bg-slate-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap z-10 pointer-events-none">
                                            Rec: {formatCurrency(item.collected)}
                                        </div>
                                    </div>
                               </div>
                               <span className="text-xs text-slate-500 mt-2 font-medium">{item.month}</span>
                           </div>
                       );
                   })}
              </div>
          )}
          
          <div className="flex justify-center gap-6 mt-6">
              <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                  <span className="text-sm text-slate-600">Facturado</span>
              </div>
              <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <span className="text-sm text-slate-600">Recaudado</span>
              </div>
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
                             <span className={`text-xs font-bold px-2 py-1 rounded-full uppercase tracking-wider ${
                                 invoice.paymentStatus === 'paid' ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-600'
                             }`}>
                                 {invoice.paymentStatus === 'paid' ? 'PAGADO' : 'PENDIENTE'}
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
