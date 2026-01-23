import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { ArrowLeft, Save, Search, CheckCircle, AlertCircle, Plus, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, addDoc, writeBatch, doc, serverTimestamp, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { formatCurrency } from '../utils/format';
import { Skeleton } from '../components/Skeleton';

export default function AdminInvoicingGeneration() {
  const navigate = useNavigate();
  
  // Selection State
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedProject, setSelectedProject] = useState(null);
  const [dateRange, setDateRange] = useState({ 
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0], // First day of current month
    end: new Date().toISOString().split('T')[0] // Today
  });

  // Invoice Data State
  const [expenses, setExpenses] = useState([]);
  const [selectedExpenses, setSelectedExpenses] = useState([]);
  const [customItems, setCustomItems] = useState([]);
  const [glosa, setGlosa] = useState('');

  // UI State
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingExpenses, setLoadingExpenses] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  // Fetch Projects on Load
  useEffect(() => {
    async function fetchProjects() {
        try {
            const q = query(collection(db, "projects"), orderBy("name"));
            const snapshot = await getDocs(q);
            setProjects(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        } catch (e) {
            console.error("Error fetching projects:", e);
            setError("Error cargando proyectos.");
        } finally {
            setLoadingProjects(false);
        }
    }
    fetchProjects();
  }, []);

  // Handle Project Selection & Auto-fill Client
  useEffect(() => {
      if (selectedProjectId) {
          const project = projects.find(p => p.id === selectedProjectId);
          setSelectedProject(project);
      } else {
          setSelectedProject(null);
          setExpenses([]);
          setSelectedExpenses([]);
      }
  }, [selectedProjectId, projects]);

  // Fetch Expenses when Project or Dates change
  useEffect(() => {
    if (!selectedProjectId) return;

    async function fetchExpenses() {
        setLoadingExpenses(true);
        try {
            // Fetch APPROVED expenses for this project
            const q = query(
                collection(db, "expenses"), 
                where("projectId", "==", selectedProjectId),
                where("status", "==", "approved")
                // Date filtering is tricky in Firestore if we also filter by status/project.
                // We will filter by date in memory for simplicity unless dataset is huge.
            );
            
            const snapshot = await getDocs(q);
            
            const validExpenses = snapshot.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(e => {
                    if (e.invoiceId) return false; // Already invoiced
                    
                    // Date Filter
                    if (!e.date) return false;
                    const expenseDate = new Date(e.date.seconds * 1000);
                    const start = new Date(dateRange.start);
                    const end = new Date(dateRange.end);
                    // Set end date to end of day
                    end.setHours(23, 59, 59, 999);
                    
                    return expenseDate >= start && expenseDate <= end;
                });

            setExpenses(validExpenses);
            // Default: Select all fetched expenses? Or none? Let's select all for convenience.
            setSelectedExpenses(validExpenses.map(e => e.id));

        } catch (e) {
            console.error("Error fetching expenses:", e);
            setError("Error cargando gastos.");
        } finally {
            setLoadingExpenses(false);
        }
    }

    if (selectedProjectId && dateRange.start && dateRange.end) {
        fetchExpenses();
    }
  }, [selectedProjectId, dateRange]);


  // Custom Items Logic
  const addCustomItem = () => {
      setCustomItems([...customItems, { description: '', amount: 0 }]);
  };

  const removeCustomItem = (index) => {
      const newItems = [...customItems];
      newItems.splice(index, 1);
      setCustomItems(newItems);
  };

  const updateCustomItem = (index, field, value) => {
      const newItems = [...customItems];
      newItems[index][field] = value;
      setCustomItems(newItems);
  };


  // Totals
  const totalExpenses = expenses
    .filter(e => selectedExpenses.includes(e.id))
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  const totalCustom = customItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  
  const totalInvoice = totalExpenses + totalCustom;


  // Generation Action
  const handleGenerateInvoice = async () => {
      if (!selectedProject) return;
      setGenerating(true);
      setError(null);

      try {
          // 1. Create Invoice Document
          const invoiceData = {
              clientId: selectedProject.client || 'Sin Cliente',
              projectId: selectedProject.id,
              projectName: selectedProject.name,
              projectRecurrence: selectedProject.recurrence || 'N/A',
              
              glosa: glosa,
              dateRange: dateRange,
              
              createdAt: serverTimestamp(),
              status: 'draft', // Initial status
              paymentStatus: 'pending', // New field for reports
              
              totalAmount: totalInvoice,
              totalExpenses: totalExpenses,
              totalCustomItems: totalCustom,
              
              expenseIds: selectedExpenses,
              customItems: customItems,
              
              itemCount: selectedExpenses.length + customItems.length
          };

          const invoiceRef = await addDoc(collection(db, "invoices"), invoiceData);

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
          setError("Ocurrió un error al generar la pre-factura.");
      } finally {
          setGenerating(false);
      }
  };

  const toggleExpense = (id) => {
      if (selectedExpenses.includes(id)) {
          setSelectedExpenses(selectedExpenses.filter(e => e !== id));
      } else {
          setSelectedExpenses([...selectedExpenses, id]);
      }
  };

  return (
    <Layout title="Generar Pre-Factura">
      <div className="mb-6">
        <Link to="/admin/invoicing" className="text-slate-500 hover:text-slate-700 flex items-center text-sm mb-2">
            <ArrowLeft className="w-4 h-4 mr-1" /> Volver al Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-slate-800">Nueva Pre-Factura</h1>
        <p className="text-slate-500">Configura los detalles de la facturación.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Configuration */}
          <div className="lg:col-span-1 space-y-6">
              
              {/* Project Selection */}
              <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100">
                  <h3 className="font-bold text-slate-800 mb-4">1. Selección de Proyecto</h3>
                  
                  <div className="mb-4">
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Proyecto</label>
                      {loadingProjects ? (
                          <Skeleton className="h-10 w-full" />
                      ) : (
                          <select 
                              className="w-full p-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                              value={selectedProjectId}
                              onChange={e => setSelectedProjectId(e.target.value)}
                          >
                              <option value="">Seleccionar...</option>
                              {projects.map(p => (
                                  <option key={p.id} value={p.id}>
                                      {p.code ? `[${p.code}] ` : ''}{p.name}
                                  </option>
                              ))}
                          </select>
                      )}
                  </div>

                  {selectedProject && (
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 mb-4">
                          <p className="text-xs text-slate-500 uppercase font-bold">Cliente Asociado</p>
                          <p className="font-bold text-slate-800">{selectedProject.client || 'Sin Cliente Asignado'}</p>
                          
                          <p className="text-xs text-slate-500 uppercase font-bold mt-2">Recurrencia</p>
                          <p className="font-medium text-slate-700">{selectedProject.recurrence || 'No definida'}</p>
                      </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Desde</label>
                          <input 
                              type="date"
                              className="w-full p-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                              value={dateRange.start}
                              onChange={e => setDateRange({...dateRange, start: e.target.value})}
                          />
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Hasta</label>
                          <input 
                              type="date"
                              className="w-full p-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                              value={dateRange.end}
                              onChange={e => setDateRange({...dateRange, end: e.target.value})}
                          />
                      </div>
                  </div>
              </div>

              {/* Glosa */}
              <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100">
                  <h3 className="font-bold text-slate-800 mb-4">2. Detalles Generales</h3>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Glosa / Descripción</label>
                  <textarea 
                      className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm h-24 resize-none"
                      placeholder="Ej: Cobro mensual servicios de ingeniería..."
                      value={glosa}
                      onChange={e => setGlosa(e.target.value)}
                  />
              </div>

              {/* Custom Items */}
              <div className="bg-white p-6 rounded-2xl shadow-soft border border-slate-100">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="font-bold text-slate-800">3. Items Adicionales</h3>
                      <button onClick={addCustomItem} className="text-indigo-600 hover:bg-indigo-50 p-1 rounded transition">
                          <Plus className="w-4 h-4" />
                      </button>
                  </div>
                  
                  {customItems.length === 0 ? (
                      <p className="text-sm text-slate-400 italic text-center py-2">No hay items adicionales</p>
                  ) : (
                      <div className="space-y-3">
                          {customItems.map((item, idx) => (
                              <div key={idx} className="flex gap-2 items-start">
                                  <div className="flex-1 space-y-1">
                                      <input 
                                          type="text" 
                                          placeholder="Descripción"
                                          className="w-full p-1.5 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-indigo-500 outline-none"
                                          value={item.description}
                                          onChange={e => updateCustomItem(idx, 'description', e.target.value)}
                                      />
                                      <input 
                                          type="number" 
                                          placeholder="Monto"
                                          className="w-full p-1.5 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-indigo-500 outline-none"
                                          value={item.amount}
                                          onChange={e => updateCustomItem(idx, 'amount', e.target.value)}
                                      />
                                  </div>
                                  <button onClick={() => removeCustomItem(idx)} className="text-red-400 hover:text-red-600 p-1">
                                      <Trash2 className="w-4 h-4" />
                                  </button>
                              </div>
                          ))}
                      </div>
                  )}
                  {customItems.length > 0 && (
                       <div className="mt-4 pt-4 border-t border-slate-100 text-right">
                           <p className="text-xs text-slate-500 uppercase font-bold">Subtotal Items</p>
                           <p className="font-bold text-slate-800">{formatCurrency(totalCustom)}</p>
                       </div>
                  )}
              </div>

          </div>

          {/* Right Column: Expenses & Summary */}
          <div className="lg:col-span-2 space-y-6">
              
              {/* Expenses List */}
              <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden min-h-[400px]">
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                      <h3 className="font-bold text-slate-800">Gastos a Incluir</h3>
                      {expenses.length > 0 && (
                          <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-bold">
                              {selectedExpenses.length} / {expenses.length}
                          </span>
                      )}
                  </div>

                  {loadingExpenses ? (
                      <div className="p-6 space-y-4">
                          <Skeleton className="h-12 w-full" />
                          <Skeleton className="h-12 w-full" />
                          <Skeleton className="h-12 w-full" />
                      </div>
                  ) : !selectedProject ? (
                        <div className="p-12 text-center text-slate-400">
                            <Search className="w-12 h-12 mx-auto mb-3 opacity-20" />
                            <p>Selecciona un proyecto para buscar gastos.</p>
                        </div>
                  ) : expenses.length === 0 ? (
                        <div className="p-12 text-center text-slate-400">
                            <CheckCircle className="w-12 h-12 mx-auto mb-3 opacity-20" />
                            <p>No se encontraron gastos aprobados en este rango de fechas.</p>
                        </div>
                  ) : (
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
                                          onChange={() => {}} 
                                          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 pointer-events-none"
                                      />
                                      <div>
                                          <p className="font-bold text-slate-800 text-sm">{expense.description}</p>
                                          <p className="text-xs text-slate-500">
                                              {new Date(expense.date?.seconds * 1000).toLocaleDateString()} • {expense.category}
                                          </p>
                                      </div>
                                  </div>
                                  <div className="font-bold text-slate-700">
                                      {formatCurrency(Number(expense.amount))}
                                  </div>
                              </div>
                          ))}
                      </div>
                  )}
              </div>

              {/* Total Summary */}
              <div className="bg-slate-900 rounded-2xl shadow-lg p-6 text-white">
                  <h3 className="text-lg font-bold mb-6">Resumen Pre-Factura</h3>
                  
                  <div className="space-y-3 mb-6 border-b border-slate-700 pb-6">
                      <div className="flex justify-between">
                          <span className="text-slate-400 text-sm">Gastos Seleccionados ({selectedExpenses.length})</span>
                          <span className="font-medium">{formatCurrency(totalExpenses)}</span>
                      </div>
                      <div className="flex justify-between">
                          <span className="text-slate-400 text-sm">Items Adicionales ({customItems.length})</span>
                          <span className="font-medium">{formatCurrency(totalCustom)}</span>
                      </div>
                  </div>

                  <div className="flex justify-between items-end mb-8">
                      <span className="text-xl font-bold">Total a Facturar</span>
                      <span className="text-3xl font-extrabold text-indigo-400">{formatCurrency(totalInvoice)}</span>
                  </div>

                  {error && (
                      <div className="mb-4 p-3 bg-red-500/20 text-red-300 rounded-lg text-sm flex items-center">
                          <AlertCircle className="w-4 h-4 mr-2" />
                          {error}
                      </div>
                  )}

                  <button 
                      onClick={handleGenerateInvoice}
                      disabled={generating || (!selectedProject)}
                      className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg transition flex justify-center items-center ${
                          generating || !selectedProject 
                          ? 'bg-slate-700 text-slate-500 cursor-not-allowed' 
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                      }`}
                  >
                      {generating ? (
                          <>
                           Generando...
                          </>
                      ) : (
                          <>
                            <Save className="w-5 h-5 mr-2" /> Generar Pre-Factura
                          </>
                      )}
                  </button>
              </div>

          </div>
      </div>
    </Layout>
  );
}
