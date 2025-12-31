import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { db } from '../lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, updateDoc, increment } from 'firebase/firestore';
import { formatCurrency } from '../utils/format';
import { ArrowLeft, CheckCircle, XCircle, FileText, Calendar, Wallet } from 'lucide-react';

export default function AdminUserDetails() {
  const { id } = useParams();
  const [user, setUser] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
        setLoading(true);
        // 1. Get User
        const uRef = doc(db, "users", id);
        const uSnap = await getDoc(uRef);
        if (uSnap.exists()) {
            let userData = { id: uSnap.id, ...uSnap.data() };
            
            // 2.2 Special Case: Terreno
            if (userData.email === 'terreno@etfa-ruido.cl' && (!userData.code || userData.code !== 'TER')) {
                // Auto-fix in memory (and ideally in DB, but let's stick to display for read-only view)
                userData.code = 'TER';
            }
            setUser(userData);
        }

        // 2. Get Expenses
        // Note: Filters by userId implies "Expenses SUBMITTED by this user" or "Expenses CREDITED to this user"? 
        // In our model, userId stores the beneficiary of the credit. 
        // For 'On Behalf Of', if Admin credited User A, userId is User A. So checking userId is correct to see their "Claims".
        const qExp = query(collection(db, "expenses"), where("userId", "==", id));
        const expSnap = await getDocs(qExp);
        const expData = expSnap.docs
            .map(d => ({id: d.id, ...d.data()}))
            .sort((a,b) => new Date(b.date) - new Date(a.date));
        setExpenses(expData);

        // 3. Get Allocations
        const qAlloc = query(collection(db, "allocations"), where("userId", "==", id));
        const allocSnap = await getDocs(qAlloc);
        const allocData = allocSnap.docs
            .map(d => ({id: d.id, ...d.data()}))
            .sort((a,b) => new Date(b.date) - new Date(a.date));
        setAllocations(allocData);

    } catch (e) {
        console.error("Error fetching details:", e);
    } finally {
        setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) fetchData();
  }, [id, fetchData]);

  const handleUpdateStatus = async (expenseId, newStatus, amount) => {
    if (!confirm(`¿Estás seguro de cambiar el estado a ${newStatus.toUpperCase()}?`)) return;

    try {
        const expenseRef = doc(db, "expenses", expenseId);
        
        // If Rejecting, we need to REVERSE the balance credit (subtract amount)
        let balanceChange = 0;
        if (newStatus === 'rejected') {
             const exp = expenses.find(e => e.id === expenseId);
             if (exp && !exp.isCompanyExpense) {
                 const userRef = doc(db, "users", id);
                 await updateDoc(userRef, {
                     balance: increment(-amount) 
                 });
                 balanceChange = -amount;
             }
        }
    
        await updateDoc(expenseRef, { status: newStatus });
        
        // Update Project Expenses Total if Approved
        if (newStatus === 'approved') {
             const exp = expenses.find(e => e.id === expenseId);
             if (exp?.projectId) {
                await updateDoc(doc(db, "projects", exp.projectId), {
                    expenses: increment(amount)
                });
             }
        }

        alert("Estado actualizado.");
        
        // Optimistic / Local Update (No Re-fetch)
        setExpenses(prev => prev.map(e => {
            if (e.id === expenseId) return { ...e, status: newStatus };
            return e;
        }));
        
        if (balanceChange !== 0) {
            setUser(prev => ({ ...prev, balance: (prev.balance || 0) + balanceChange }));
        }

    } catch (e) {
        console.error("Error updating status:", e);
        alert("Error al actualizar.");
    }
  };


  if (loading) return <Layout title="Detalles del Usuario">Cargando...</Layout>;
  if (!user) return <Layout title="Error">Usuario no encontrado.</Layout>;

  return (
    <Layout title={`Profesional: ${user.displayName}`}>
        <div className="mb-6">
            <Link to="/admin/balances" className="text-blue-600 hover:text-blue-800 flex items-center">
                <ArrowLeft className="w-4 h-4 mr-2" /> Volver a Balances
            </Link>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex items-center">
                <div className="mr-4 bg-gray-100 p-3 rounded-full">
                    <User className="w-8 h-8 text-gray-500" />
                </div>
                <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Información</h3>
                    <p className="text-lg font-bold text-gray-800">
                        {user.displayName} {user.code ? `[${user.code}]` : ''}
                    </p>
                    <p className="text-sm text-gray-500">{user.email}</p>
                    <p className="text-sm text-gray-500 capitalize">{user.role}</p>
                </div>
            </div>
            <div className="bg-gradient-to-br from-blue-600 to-blue-800 p-6 rounded-lg shadow-sm border border-blue-500 text-white relative overflow-hidden">
                 <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Wallet className="w-16 h-16" />
                </div>
                <div className="relative z-10">
                    <h3 className="text-blue-100 text-sm font-medium mb-1">Saldo Actual (Viático)</h3>
                    <p className="text-3xl font-bold">
                        {formatCurrency(user.balance || 0)}
                    </p>
                    <p className="text-blue-200 text-xs mt-1">
                        {(user.balance || 0) < 0 ? "Fondos por Rendir" : "Saldo a Favor"}
                    </p>
                </div>
            </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            
            {/* Expenses List */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b bg-gray-50 flex justify-between items-center">
                    <h3 className="font-bold text-gray-700 flex items-center">
                        <FileText className="w-5 h-5 mr-2 text-gray-400" />
                        Historial de Rendiciones
                    </h3>
                    <span className="text-xs font-medium bg-gray-200 text-gray-600 px-2 py-1 rounded-full">{expenses.length}</span>
                </div>
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="sticky top-0 bg-white">
                            <tr className="border-b">
                                <th className="px-4 py-3 font-medium text-gray-500">Fecha</th>
                                <th className="px-4 py-3 font-medium text-gray-500">Proyecto</th>
                                <th className="px-4 py-3 font-medium text-gray-500">Detalle</th>
                                <th className="px-4 py-3 font-medium text-gray-500">Monto</th>
                                <th className="px-4 py-3 font-medium text-gray-500">Estado</th>
                                <th className="px-4 py-3 font-medium text-gray-500">Acción</th>
                            </tr>
                        </thead>
                        <tbody>
                            {expenses.map(e => (
                                <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                                    <td className="px-4 py-3 text-gray-600">{e.date}</td>
                                    <td className="px-4 py-3 text-gray-800 font-medium">
                                        {e.projectName}
                                    </td>
                                    <td className="px-4 py-3 text-gray-600">
                                        <p className="font-medium">{e.category}</p>
                                        <p className="text-xs truncate max-w-[150px]">{e.description}</p>
                                        {e.imageUrl && (
                                            <a href={e.imageUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline text-xs block mt-1">Ver Boleta</a>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 font-bold text-gray-700">{formatCurrency(e.amount)}</td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-1 rounded-full text-xs font-semibold
                                            ${e.status === 'approved' ? 'bg-green-100 text-green-800' : 
                                              e.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                            {e.status === 'approved' ? 'Aprobado' : e.status === 'rejected' ? 'Rechazado' : 'Pendiente'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        {e.status === 'pending' && (
                                            <div className="flex space-x-2">
                                                <button onClick={() => handleUpdateStatus(e.id, 'approved', e.amount)} className="text-green-600 hover:text-green-800" title="Aprobar">
                                                    <CheckCircle className="w-5 h-5" />
                                                </button>
                                                <button onClick={() => handleUpdateStatus(e.id, 'rejected', e.amount)} className="text-red-600 hover:text-red-800" title="Rechazar">
                                                    <XCircle className="w-5 h-5" />
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                             {expenses.length === 0 && (
                                <tr>
                                    <td colSpan="6" className="px-4 py-8 text-center text-gray-500">No hay rendiciones registradas.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Allocations List */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b bg-gray-50 flex justify-between items-center">
                    <h3 className="font-bold text-gray-700 flex items-center">
                        <Calendar className="w-5 h-5 mr-2 text-gray-400" />
                        Historial de Viáticos Recibidos
                    </h3>
                     <span className="text-xs font-medium bg-gray-200 text-gray-600 px-2 py-1 rounded-full">{allocations.length}</span>
                </div>
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <table className="w-full text-left text-sm">
                         <thead className="sticky top-0 bg-white">
                            <tr className="border-b">
                                <th className="px-4 py-3 font-medium text-gray-500">Fecha</th>
                                <th className="px-4 py-3 font-medium text-gray-500">Proyecto</th>
                                <th className="px-4 py-3 font-medium text-gray-500">Monto</th>
                            </tr>
                        </thead>
                        <tbody>
                            {allocations.map(a => (
                                <tr key={a.id} className="border-b last:border-0 hover:bg-gray-50">
                                    <td className="px-4 py-3 text-gray-600">{new Date(a.date).toLocaleDateString()}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center">
                                            {a.projectName}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 font-bold text-gray-700">{formatCurrency(a.amount)}</td>
                                </tr>
                            ))}
                            {allocations.length === 0 && (
                                <tr>
                                    <td colSpan="3" className="px-4 py-8 text-center text-gray-500">No hay viáticos asignados.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

        </div>
    </Layout>
  );
}
