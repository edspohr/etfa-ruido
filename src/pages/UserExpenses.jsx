import Layout from '../components/Layout';
import { mockExpenses, formatCurrency } from '../lib/mockData';

export default function UserExpenses() {
  return (
    <Layout title="Mis Rendiciones Históricas">
       <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
         <table className="w-full text-left">
            <thead>
                <tr className="bg-gray-50 border-b">
                     <th className="px-6 py-3 font-medium text-gray-500">Fecha</th>
                     <th className="px-6 py-3 font-medium text-gray-500">Descripción</th>
                     <th className="px-6 py-3 font-medium text-gray-500">Monto</th>
                     <th className="px-6 py-3 font-medium text-gray-500">Estado</th>
                </tr>
            </thead>
            <tbody>
                {mockExpenses.map(e => (
                    <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="px-6 py-4 text-gray-600">{e.date}</td>
                        <td className="px-6 py-4 text-gray-800">{e.description}</td>
                        <td className="px-6 py-4 font-medium">{formatCurrency(e.amount)}</td>
                        <td className="px-6 py-4">
                            <span className={`px-2 py-1 rounded-full text-xs font-semibold 
                                ${e.status === 'approved' ? 'bg-green-100 text-green-800' : 
                                  e.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                                {e.status === 'approved' ? 'Aprobado' : e.status === 'pending' ? 'Pendiente' : 'Rechazado'}
                            </span>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
       </div>
    </Layout>
  );
}
