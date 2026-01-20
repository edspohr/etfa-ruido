import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { formatCurrency } from '../utils/format';
import { Wallet, ArrowRight, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { recalculateAllUserBalances } from '../utils/fixBalances';
import { toast } from 'sonner';

export default function AdminBalances() {
  const [professionals, setProfessionals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState(false);

  useEffect(() => {
    fetchPros();
  }, []);

  async function fetchPros() {
      try {
          const q = query(collection(db, "users"), where("role", "in", ["professional", "admin"]));
          const snapshot = await getDocs(q);
          const data = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
          setProfessionals(data);
      } catch (e) {
          console.error("Error fetching professionals:", e);
      } finally {
          setLoading(false);
      }
  }

  const handleRepairBalances = async () => {
      if (!confirm("Esto recalculará todos los saldos basándose en el historial. ¿Continuar?")) return;
      setRepairing(true);
      try {
          await recalculateAllUserBalances();
          toast.success("Saldos recalculados exitosamente.");
          await fetchPros(); // Refresh UI
      } catch (e) {
          console.error("Repair error:", e);
          toast.error("Error al recalcular.");
      } finally {
          setRepairing(false);
      }
  };

  if (loading) return <Layout title="Balances de Profesionales"><p>Cargando...</p></Layout>;

  return (
    <Layout title="Balances de Profesionales">
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
            <h3 className="font-bold text-gray-700">Estado de Cuentas Corrientes</h3>
            <div className="flex gap-2">
                <button 
                    onClick={handleRepairBalances}
                    disabled={repairing}
                    className="text-sm bg-orange-100 text-orange-700 px-3 py-2 rounded hover:bg-orange-200 flex items-center font-bold disabled:opacity-50"
                >
                    <RefreshCw className={`w-4 h-4 mr-2 ${repairing ? 'animate-spin' : ''}`} />
                    {repairing ? 'Reparando...' : 'Recalcular Saldos (Repair)'}
                </button>
                <Link to="/admin/projects" className="text-sm text-blue-600 hover:text-blue-800 flex items-center px-3 py-2">
                    Ir a Cargar Saldos <ArrowRight className="w-4 h-4 ml-1" />
                </Link>
            </div>
        </div>
        
        <div className="overflow-x-auto">
            <table className="w-full text-left">
                <thead>
                    <tr className="bg-white border-b">
                        <th className="px-6 py-4 font-medium text-gray-500">Profesional</th>
                        <th className="px-6 py-4 font-medium text-gray-500">Email</th>
                        <th className="px-6 py-4 font-medium text-gray-500">Saldo Disponible (Viático)</th>
                        <th className="px-6 py-4 font-medium text-gray-500">Estado</th>
                    </tr>
                </thead>
                <tbody>
                    {professionals.map(u => (
                        <tr key={u.id} className="border-b last:border-0 hover:bg-gray-50">
                            <td className="px-6 py-4 font-medium text-gray-800 flex items-center">
                                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mr-3 font-bold text-xs">
                                    {u.displayName?.substring(0,2).toUpperCase()}
                                </div>
                                <Link to={`/admin/users/${u.id}`} className="hover:text-blue-600 hover:underline font-bold">
                                    {u.displayName} {u.code ? `[${u.code}]` : ''} <span className="text-gray-400 font-normal text-xs ml-1">({u.email})</span>
                                </Link>
                            </td>
                            <td className="px-6 py-4 text-gray-600 hidden">{u.email}</td> {/* Hidden email col as it affects layout if too long, integrated in name */}
                            <td className="px-6 py-4">
                                <div className="flex items-center">
                                    <Wallet className="w-4 h-4 text-gray-400 mr-2" />
                                    <span className={`font-mono font-semibold ${u.balance < 0 ? 'text-red-500' : 'text-green-600'}`}>
                                        {formatCurrency(u.balance || 0)}
                                    </span>
                                </div>
                            </td>
                            <td className="px-6 py-4">
                                {(u.balance || 0) < 0 ? (
                                    <span className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs font-semibold">Por Rendir (Fondos)</span>
                                ) : (u.balance || 0) > 0 ? (
                                    <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-xs font-semibold">Saldo a Favor</span>
                                ) : (
                                    <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded-full text-xs font-semibold">Saludable (0)</span>
                                )}
                            </td>
                        </tr>
                    ))}
                    {professionals.length === 0 && (
                        <tr>
                            <td colSpan="4" className="px-6 py-8 text-center text-gray-500">No hay profesionales registrados.</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
      </div>
    </Layout>
  );
}
