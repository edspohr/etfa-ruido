import { useState } from 'react';
import Layout from '../components/Layout';
import { mockExpenses, mockProjects, mockUsers, formatCurrency } from '../lib/mockData';

export default function AdminInvoicing() {
  const [groupBy, setGroupBy] = useState('project'); // 'project' or 'professional'

  const approvedExpenses = mockExpenses.filter(e => e.status === 'approved');

  const groupedData = approvedExpenses.reduce((acc, expense) => {
    const key = groupBy === 'project' ? expense.projectId : expense.userId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(expense);
    return acc;
import { db } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { formatCurrency } from '../lib/mockData';
import { Wallet, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function AdminBalances() {
  const [professionals, setProfessionals] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPros() {
        try {
            const q = query(collection(db, "users"), where("role", "==", "professional"));
            const snapshot = await getDocs(q);
            const data = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
            setProfessionals(data);
        } catch (e) {
            console.error("Error fetching professionals:", e);
        } finally {
            setLoading(false);
        }
    }
    fetchPros();
  }, []);

  if (loading) return <Layout title="Balances de Profesionales"><p>Cargando...</p></Layout>;

  return (
            <button 
                onClick={() => setGroupBy('professional')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${groupBy === 'professional' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
            >
                Por Profesional
            </button>
        </div>
      </div>

      <div className="space-y-6">
        {Object.keys(groupedData).length === 0 ? (
            <div className="text-center py-10 bg-white rounded-lg border border-dashed border-gray-300 text-gray-400">
                No hay gastos aprobados pendientes de facturar.
            </div>
        ) : Object.entries(groupedData).map(([key, expenses]) => {
            const total = expenses.reduce((sum, e) => sum + e.amount, 0);
            return (
                <div key={key} className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                    <div className="bg-gray-50 px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                        <div>
                            <h3 className="font-semibold text-lg text-gray-800">{getGroupTitle(key)}</h3>
                            <p className="text-sm text-gray-500">{expenses.length} movimientos</p>
                        </div>
                        <div className="text-right">
                            <p className="text-sm text-gray-500">Total a Facturar/Reembolsar</p>
                            <p className="font-bold text-xl text-gray-900">{formatCurrency(total)}</p>
                        </div>
                    </div>
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-white border-b text-xs text-gray-400 uppercase tracking-wider">
                                <th className="px-6 py-3 font-medium">Fecha</th>
                                <th className="px-6 py-3 font-medium">Descripción</th>
                                {groupBy === 'project' && <th className="px-6 py-3 font-medium">Responsable</th>}
                                {groupBy === 'professional' && <th className="px-6 py-3 font-medium">Proyecto</th>}
                                <th className="px-6 py-3 font-medium text-right">Monto</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {expenses.map(e => {
                                const userName = Object.values(mockUsers).find(u => u.uid === e.userId)?.displayName;
                                const projectName = mockProjects.find(p => p.id === e.projectId)?.name;
                                return (
                                    <tr key={e.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-3 text-sm text-gray-600">{e.date}</td>
                                        <td className="px-6 py-3 text-sm text-gray-800">{e.description}</td>
                                        {groupBy === 'project' && <td className="px-6 py-3 text-sm text-gray-500">{userName}</td>}
                                        {groupBy === 'professional' && <td className="px-6 py-3 text-sm text-gray-500">{projectName}</td>}
                                        <td className="px-6 py-3 text-sm font-medium text-gray-900 text-right">{formatCurrency(e.amount)}</td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            );
        })}
      </div>
    </Layout>
  );
}
