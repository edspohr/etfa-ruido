import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { mockProjects, formatCurrency } from '../lib/mockData';
import { PlusCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function UserDashboard() {
  const { currentUser } = useAuth();
  // In real app, fetch user balance from context/firestore
  const userBalance = 350000; 

  return (
    <Layout title={`Hola, ${currentUser?.displayName?.split(' ')[0] || 'Usuario'}`}>
         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                <h3 className="text-gray-500 text-sm font-medium">Mi Cuenta Corriente (Viáticos)</h3>
                <p className="text-4xl font-bold text-blue-600">{formatCurrency(userBalance)}</p>
                <p className="text-gray-400 text-sm mt-2">Saldo disponible para gastos.</p>
            </div>
            
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col justify-center">
                 <Link to="/dashboard/new-expense" className="w-full bg-green-600 text-white px-4 py-4 rounded-lg hover:bg-green-700 text-lg flex items-center justify-center font-semibold transition shadow-lg hover:shadow-xl transform hover:-translate-y-0.5">
                    <PlusCircle className="mr-2 w-6 h-6" />
                    Rendir un Gasto
                </Link>
            </div>
        </div>

        <div className="mt-8 bg-white p-6 rounded-lg shadow-sm border border-gray-100">
            <h2 className="text-xl font-semibold mb-4">Mis Proyectos Asignados</h2>
            <div className="space-y-4">
                {mockProjects.slice(0, 2).map(p => (
                     <div key={p.id} className="border-b last:border-0 pb-4 last:pb-0 flex justify-between items-center">
                        <div>
                            <p className="font-semibold text-gray-800">{p.name}</p>
                            <p className="text-sm text-gray-600">{p.client}</p>
                        </div>
                        <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">Activo</span>
                    </div>
                ))}
            </div>
        </div>
    </Layout>
  );
}
