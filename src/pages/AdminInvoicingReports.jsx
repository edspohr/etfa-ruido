import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { formatCurrency } from '../utils/format';
import { Skeleton } from '../components/Skeleton';
import { TrendingUp, DollarSign, PieChart as PieIcon, BarChart3 } from 'lucide-react';

export default function AdminInvoicingReports() {
  const [data, setData] = useState({
      totalBilled: 0,
      totalCollected: 0,
      pendingCollection: 0,
      monthlyData: [], // { month: 'Ene', billed: 100, collected: 80 }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
        try {
            const snapshot = await getDocs(collection(db, "invoices"));
            const invoices = snapshot.docs.map(d => d.data());

            let billed = 0;
            let collected = 0;
            let pending = 0;

            // Simple monthly aggregation
            const months = {}; // "2024-01": { billed: 0, collected: 0 }

            invoices.forEach(inv => {
                const amount = Number(inv.totalAmount) || 0;
                billed += amount;
                
                if (inv.paymentStatus === 'paid') {
                    collected += amount;
                } else {
                    pending += amount;
                }

                // Monthly Data
                if (inv.createdAt?.seconds) {
                    const date = new Date(inv.createdAt.seconds * 1000);
                    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                    
                    if (!months[key]) months[key] = { billed: 0, collected: 0 };
                    
                    months[key].billed += amount;
                    if (inv.paymentStatus === 'paid') {
                        months[key].collected += amount;
                    }
                }
            });

            // Convert months map to array sorted by date
            const monthlyData = Object.keys(months).sort().map(key => {
                const [y, m] = key.split('-');
                const date = new Date(y, m - 1);
                const monthName = date.toLocaleString('es-ES', { month: 'short' });
                return {
                    month: `${monthName} ${y}`,
                    ...months[key]
                };
            });

            setData({
                totalBilled: billed,
                totalCollected: collected,
                pendingCollection: pending,
                monthlyData
            });

        } catch (e) {
            console.error("Error fetching reports:", e);
        } finally {
            setLoading(false);
        }
    }
    fetchData();
  }, []);

  return (
    <Layout title="Reportes de Facturación">
      
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100 flex items-center justify-between">
              <div>
                  <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Total Facturado</p>
                  {loading ? <Skeleton className="h-8 w-32" /> : (
                      <p className="text-3xl font-extrabold text-blue-600">{formatCurrency(data.totalBilled)}</p>
                  )}
              </div>
              <div className="bg-blue-50 p-3 rounded-full text-blue-600">
                  <BarChart3 className="w-6 h-6" />
              </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100 flex items-center justify-between">
              <div>
                  <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Total Recaudado</p>
                  {loading ? <Skeleton className="h-8 w-32" /> : (
                      <p className="text-3xl font-extrabold text-green-500">{formatCurrency(data.totalCollected)}</p>
                  )}
              </div>
              <div className="bg-green-50 p-3 rounded-full text-green-500">
                  <DollarSign className="w-6 h-6" />
              </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100 flex items-center justify-between">
              <div>
                  <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Pendiente de Cobro</p>
                  {loading ? <Skeleton className="h-8 w-32" /> : (
                      <p className="text-3xl font-extrabold text-orange-500">{formatCurrency(data.pendingCollection)}</p>
                  )}
              </div>
              <div className="bg-orange-50 p-3 rounded-full text-orange-500">
                  <TrendingUp className="w-6 h-6" />
              </div>
          </div>
      </div>

      {/* Monthly Chart (CSS Only) */}
      <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100">
          <h3 className="font-bold text-slate-800 mb-6">Facturación vs Recaudación (Mensual)</h3>
          
          {loading ? (
              <Skeleton className="h-64 w-full" />
          ) : data.monthlyData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-slate-400">
                  No hay datos suficientes para mostrar el gráfico.
              </div>
          ) : (
              <div className="relative h-64 flex items-end gap-4 mt-8 pb-6 border-b border-slate-200">
                   {data.monthlyData.map((item, idx) => {
                       const maxVal = Math.max(...data.monthlyData.map(d => Math.max(d.billed, d.collected)));
                       const billedH = maxVal > 0 ? (item.billed / maxVal) * 100 : 0;
                       const collectedH = maxVal > 0 ? (item.collected / maxVal) * 100 : 0;
                       
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

    </Layout>
  );
}
