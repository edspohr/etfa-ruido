import Layout from '../components/Layout';
import { mockProjects, formatCurrency } from '../lib/mockData';

export default function AdminProjects() {
  return (
    <Layout title="Gestión de Proyectos">
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left">
            <thead>
                <tr className="bg-gray-50 border-b">
                    <th className="px-6 py-3 font-medium text-gray-500">Proyecto</th>
                    <th className="px-6 py-3 font-medium text-gray-500">Cliente</th>
                    <th className="px-6 py-3 font-medium text-gray-500">Presupuesto</th>
                    <th className="px-6 py-3 font-medium text-gray-500">Gastado</th>
                    <th className="px-6 py-3 font-medium text-gray-500">Estado</th>
                </tr>
            </thead>
            <tbody>
                {mockProjects.map(p => (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="px-6 py-4 font-medium">{p.name}</td>
                        <td className="px-6 py-4 text-gray-600">{p.client}</td>
                        <td className="px-6 py-4">{formatCurrency(p.budget)}</td>
                        <td className="px-6 py-4">{formatCurrency(p.expenses)}</td>
                        <td className="px-6 py-4"><span className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs font-semibold">Activo</span></td>
                    </tr>
                ))}
            </tbody>
        </table>
      </div>
    </Layout>
  );
}
