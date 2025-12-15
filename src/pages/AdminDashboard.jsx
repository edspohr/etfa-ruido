import Layout from '../components/Layout';
import { mockProjects, mockExpenses, formatCurrency } from '../lib/mockData';

export default function AdminDashboard() {
  const pendingCount = mockExpenses.filter(e => e.status === 'pending').length;
  const totalBudget = mockProjects.reduce((acc, p) => acc + p.budget, 0);

  return (
    <Layout title="Dashboard General">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                <h3 className="text-gray-500 text-sm font-medium">Proyectos Activos</h3>
                <p className="text-3xl font-bold text-gray-800">{mockProjects.length}</p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                <h3 className="text-gray-500 text-sm font-medium">Presupuesto Total</h3>
                <p className="text-3xl font-bold text-gray-800">{formatCurrency(totalBudget)}</p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                <h3 className="text-gray-500 text-sm font-medium">Rendiciones Pendientes</h3>
                <p className="text-3xl font-bold text-orange-500">{pendingCount}</p>
            </div>
        </div>

        <div className="mt-8">
            <h2 className="text-xl font-bold mb-4 text-gray-800">Resumen de Proyectos</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {mockProjects.map(p => {
                    const progress = (p.expenses / p.budget) * 100;
                    return (
                        <div key={p.id} className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                             <div className="flex justify-between items-center mb-2">
                                <h3 className="font-semibold text-gray-800">{p.name}</h3>
                                <span className={`text-sm font-bold ${progress > 100 ? 'text-red-600' : 'text-green-600'}`}>
                                    {((p.budget - p.expenses) / p.budget * 100).toFixed(1)}% Margen
                                </span>
                             </div>
                             <div className="w-full bg-gray-200 rounded-full h-2.5">
                                <div className={`h-2.5 rounded-full ${progress > 100 ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${Math.min(progress, 100)}%` }}></div>
                             </div>
                             <div className="flex justify-between text-xs text-gray-500 mt-2">
                                <span>Gastado: {formatCurrency(p.expenses)}</span>
                                <span>Total: {formatCurrency(p.budget)}</span>
                             </div>
                        </div>
                    );
                })}
            </div>
        </div>
    </Layout>
  );
}
