import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { ArrowLeft, Save, Search, CheckCircle, AlertCircle } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, addDoc, writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { formatCurrency } from '../utils/format';
import { Skeleton } from '../components/Skeleton';

export default function AdminInvoicingGeneration() {
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [selectedClient, setSelectedClient] = useState('');
  const [selectedExpenses, setSelectedExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchClients() {
        try {
            const projectsSnap = await getDocs(collection(db, "projects"));
            const uniqueClients = new Set();
            projectsSnap.docs.forEach(doc => {
                const data = doc.data();
                if (data.client) uniqueClients.add(data.client);
            });
            setClients(Array.from(uniqueClients).sort());
        } catch (e) {
            console.error("Error fetching clients:", e);
        } finally {
            setLoading(false);
        }
    }
    fetchClients();
  }, []);

  useEffect(() => {
    if (!selectedClient) {
        setExpenses([]);
        setSelectedExpenses([]);
        return;
    }

    async function fetchClientExpenses() {
        setLoading(true);
        try {
            // 1. Get projects for this client
            const projectsQ = query(collection(db, "projects"), where("client", "==", selectedClient));
            const projectsSnap = await getDocs(projectsQ);
            const projectIds = projectsSnap.docs.map(d => d.id);
            const projectNames = projectsSnap.docs.reduce((acc, d) => {
                acc[d.id] = d.data().name;
                return acc;
            }, {});

            if (projectIds.length === 0) {
                setExpenses([]);
                return;
            }

            // 2. Get APPROVED expenses for these projects that are NOT invoiced yet
            // Note: Firestore 'in' query supports max 10 items. If a client has >10 projects, this breaks.
            // Better strategy: Fetch all approved expenses and filter in memory (if dataset is small)
            // OR iterate fetches. For now, assuming reasonable size, let's fetch all approved and filter.
            
            const expensesQ = query(collection(db, "expenses"), where("status", "==", "approved"));
            const expensesSnap = await getDocs(expensesQ);
            
            const relevantExpenses = expensesSnap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(e => projectIds.includes(e.projectId) && !e.invoiceId); // Filter by client projects AND not invoiced

            // Add project name to expense
            const enrichedExpenses = relevantExpenses.map(e => ({
                ...e,
                projectName: projectNames[e.projectId] || 'Desconocido'
            }));

            setExpenses(enrichedExpenses);
        } catch (e) {
            console.error("Error fetching expenses:", e);
        } finally {
            setLoading(false);
        }
    }

    fetchClientExpenses();
  }, [selectedClient]);

  const toggleExpense = (expenseId) => {
    if (selectedExpenses.includes(expenseId)) {
        setSelectedExpenses(selectedExpenses.filter(id => id !== expenseId));
    } else {
        setSelectedExpenses([...selectedExpenses, expenseId]);
    }
  };

  const selectAll = () => {
    if (selectedExpenses.length === expenses.length) {
        setSelectedExpenses([]);
    } else {
        setSelectedExpenses(expenses.map(e => e.id));
    }
  };

  const handleGenerateInvoice = async () => {
      if (selectedExpenses.length === 0) return;
      setGenerating(true);
      setError(null);

      try {
          const totalAmount = expenses
             .filter(e => selectedExpenses.includes(e.id))
             .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

          // 1. Create Invoice Document
          const invoiceRef = await addDoc(collection(db, "invoices"), {
              clientId: selectedClient,
              clientName: selectedClient,
              createdAt: serverTimestamp(),
              status: 'draft', // or 'generated'?
              totalAmount: totalAmount,
              expenseIds: selectedExpenses,
              count: selectedExpenses.length
          });

          // 2. Update Expenses with invoiceId
          const batch = writeBatch(db);
          selectedExpenses.forEach(expId => {
              const expRef = doc(db, "expenses", expId);
              batch.update(expRef, { invoiceId: invoiceRef.id, invoiceStatus: 'draft' });
          });

          await batch.commit();
          
          navigate('/admin/invoicing');
      } catch (e) {
          console.error("Error generating invoice:", e);
          setError("Ocurrió un error al generar la pre-factura. Inténtalo de nuevo.");
      } finally {
          setGenerating(false);
      }
  };

  const totalSelected = expenses
    .filter(e => selectedExpenses.includes(e.id))
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  return (
    <Layout title="Generar Pre-Factura">
      <div className="mb-6">
        <Link to="/admin/invoicing" className="text-slate-500 hover:text-slate-700 flex items-center text-sm mb-2">
            <ArrowLeft className="w-4 h-4 mr-1" /> Volver al Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-slate-800">Nueva Pre-Factura</h1>
        <p className="text-slate-500">Selecciona un cliente y los gastos a incluir (Solo gastos Aprobados).</p>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Cliente</label>
                <select 
                    className="w-full p-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={selectedClient}
                    onChange={e => setSelectedClient(e.target.value)}
                >
                    <option value="">Seleccionar Cliente...</option>
                    {clients.map(c => (
                        <option key={c} value={c}>{c}</option>
                    ))}
                </select>
            </div>
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Fecha de Emisión</label>
                <input 
                    type="date" 
                    className="w-full p-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    defaultValue={new Date().toISOString().split('T')[0]}
                    disabled
                />
            </div>
        </div>
      </div>

      {loading ? (
           <div className="space-y-4">
               <Skeleton className="h-12 w-full" />
               <Skeleton className="h-12 w-full" />
               <Skeleton className="h-12 w-full" />
           </div>
      ) : !selectedClient ? (
        <div className="bg-white p-12 text-center rounded-2xl shadow-soft border border-slate-100 text-slate-400">
            <Search className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p>Selecciona un cliente para ver los gastos disponibles.</p>
        </div>
      ) : expenses.length === 0 ? (
        <div className="bg-white p-12 text-center rounded-2xl shadow-soft border border-slate-100 text-slate-400">
            <CheckCircle className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p>No hay gastos pendientes de facturación para este cliente.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <input 
                        type="checkbox" 
                        checked={selectedExpenses.length === expenses.length && expenses.length > 0}
                        onChange={selectAll}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm font-semibold text-slate-600">
                        {selectedExpenses.length} Gastos Seleccionados ({formatCurrency(totalSelected)})
                    </span>
                </div>
            </div>
            <div className="divide-y divide-slate-100">
                {expenses.map(expense => (
                    <div 
                        key={expense.id} 
                        className={`p-4 flex items-center justify-between hover:bg-slate-50 transition cursor-pointer ${selectedExpenses.includes(expense.id) ? 'bg-indigo-50/50' : ''}`}
                        onClick={() => toggleExpense(expense.id)}
                    >
                        <div className="flex items-center gap-4">
                            <input 
                                type="checkbox"
                                checked={selectedExpenses.includes(expense.id)}
                                onChange={() => {}} // handled by parent div
                                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <div>
                                <p className="font-bold text-slate-800 text-sm">{expense.description}</p>
                                <p className="text-xs text-slate-500">
                                    {new Date(expense.date?.seconds * 1000).toLocaleDateString()} • {expense.projectName} • {expense.category}
                                </p>
                            </div>
                        </div>
                        <div className="font-bold text-slate-700">
                            {formatCurrency(Number(expense.amount))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
      )}

      {error && (
          <div className="mt-4 p-4 bg-red-100 text-red-700 rounded-xl flex items-center">
              <AlertCircle className="w-5 h-5 mr-2" />
              {error}
          </div>
      )}
      
      <div className="mt-8 flex justify-end">
          <button 
            onClick={handleGenerateInvoice}
            disabled={selectedExpenses.length === 0 || generating}
            className={`flex items-center bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 transition shadow-lg ${selectedExpenses.length === 0 || generating ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
              <Save className="w-5 h-5 mr-2" />
              {generating ? 'Generando...' : 'Generar Pre-Factura'}
          </button>
      </div>
    </Layout>
  );
}
