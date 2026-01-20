import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs, doc, updateDoc, increment, writeBatch, orderBy, limit } from 'firebase/firestore';
import { formatCurrency } from '../utils/format';
import { CheckCircle, XCircle, Download, FileText } from 'lucide-react';
import RejectionModal from '../components/RejectionModal';
import { toast } from 'sonner';
import { motion as Motion } from 'framer-motion';

export default function AdminApprovals() {
  const [pendingExpenses, setPendingExpenses] = useState([]);
  const [historyExpenses, setHistoryExpenses] = useState([]); // [NEW] History
  const [viewMode, setViewMode] = useState('pending'); // 'pending' | 'history'
  const [loading, setLoading] = useState(true);
  
  // Rejection Modal State
  const [rejectionModalOpen, setRejectionModalOpen] = useState(false);
  const [selectedExpenseToReject, setSelectedExpenseToReject] = useState(null);
  // Date Range State for Export
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchPending = async () => {
      try {
          setLoading(true);
          const q = query(collection(db, "expenses"), where("status", "==", "pending"));
          const snapshot = await getDocs(q);
          const data = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
          setPendingExpenses(data);

          // [NEW] Fetch History (Approved/Rejected) - Limit to recent 50 or date range?
          // For now, let's fetch all non-pending to keep it simple, or maybe last 100.
          // [NEW] Fetch History - Limit to recent 50 to avoid performance issues
          const qHistory = query(
            collection(db, "expenses"), 
            where("status", "in", ["approved", "rejected"]), 
            orderBy("date", "desc"),
            limit(50)
          );
          const snapshotHistory = await getDocs(qHistory);
          const dataHistory = snapshotHistory.docs.map(d => ({id: d.id, ...d.data()}));
          setHistoryExpenses(dataHistory);

      } catch (e) {
          console.error("Error fetching pending:", e);
      } finally {
          setLoading(false);
      }
  };

  const handleExportCSV = async () => {
      try {
          const q = query(collection(db, "expenses"), orderBy("date", "desc"));
          const snapshot = await getDocs(q);
          let expenses = snapshot.docs.map(d => d.data());

          // Filter by Date Range if set
          if (startDate && endDate) {
              const start = new Date(startDate);
              const end = new Date(endDate); // Ensure we include the end day? 
              // Set end to end of day
              end.setHours(23, 59, 59, 999);
              start.setHours(0, 0, 0, 0);

              expenses = expenses.filter(e => {
                  const d = new Date(e.date);
                  return d >= start && d <= end;
              });
          }

          if (expenses.length === 0) {
              toast.error("No hay registros en el rango de fechas seleccionado.");
              return;
          }

          // Fetch Projects for Code/Recurrence lookup
          const pSnapshot = await getDocs(collection(db, "projects"));
          const projectMap = {};
          pSnapshot.docs.forEach(doc => {
              const data = doc.data();
              projectMap[doc.id] = data;
              // Also map by name in case projectId is missing or legacy
              if (data.name) projectMap[data.name.toLowerCase()] = data;
          });

          // Define CSV Headers
          const headers = ["Fecha", "Profesional", "Código Proyecto", "Proyecto", "Recurrencia", "Descripción", "Categoría", "Monto", "Estado", "Motivo Rechazo"];
          
          // Map Data to CSV Rows
          const rows = expenses.map(e => {
              // Try to find project info
              let project = null;
              if (e.projectId && projectMap[e.projectId]) {
                  project = projectMap[e.projectId];
              } else if (e.projectName && projectMap[e.projectName.toLowerCase()]) {
                  project = projectMap[e.projectName.toLowerCase()];
              }

              return [
                e.date || "",
                e.userName || "",
                project?.code || "",
                e.projectName || "",
                project?.recurrence || "",
                `"${(e.description || "").replace(/"/g, '""')}"`, // Escape quotes
                e.category || "",
                e.amount || 0,
                e.status === 'approved' ? 'Aprobado' : e.status === 'rejected' ? 'Rechazado' : 'Pendiente',
                `"${(e.rejectionReason || "").replace(/"/g, '""')}"`
              ];
          });

          // Construct CSV String
          const csvContent = [
              headers.join(","),
              ...rows.map(r => r.join(","))
          ].join("\n");

          // Create Blob and Download
          const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.setAttribute("href", url);
          link.setAttribute("download", `rendiciones_etfa_${startDate || 'inicio'}_alu_${endDate || 'fin'}.csv`);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
      } catch (e) {
          console.error("Error exporting CSV:", e);
          toast.error("Error al exportar los datos.");
      }
  };


  useEffect(() => {
    fetchPending();
  }, []);

  const handleApprove = async (expense) => {
      try {
          const batch = writeBatch(db);
          
          // 1. Update Expense Status
          const expenseRef = doc(db, "expenses", expense.id);
          batch.update(expenseRef, { status: "approved" });

          // 2. Update Project Total Expenses
          if (expense.projectId) {
              const projectRef = doc(db, "projects", expense.projectId);
              batch.update(projectRef, {
                  expenses: increment(expense.amount)
              });
          }

          await batch.commit();
          toast.success("Gasto aprobado."); 
          setPendingExpenses(prev => prev.filter(e => e.id !== expense.id));
      } catch (error) {
          console.error("Error approving:", error);
          toast.error("Error al aprobar");
      }
  };

  const openRejectionModal = (expense) => {
      setSelectedExpenseToReject(expense);
      setRejectionModalOpen(true);
  };

  const handleConfirmRejection = async (expense, reason) => {
      try {
          const batch = writeBatch(db);
          
          // 1. Mark as rejected and add reason
          const expenseRef = doc(db, "expenses", expense.id);
          batch.update(expenseRef, { 
              status: "rejected",
              rejectionReason: reason 
          });

          // 2. Refund User (Fix: Do NOT override to 'user_caja_chica' if it was a personal submission)
          // The expense.userId contains the ID of the balance that was credited.
          // We simply reverse it.
          
          let targetUserId = expense.userId;
          // Note: If the expense was "isCompanyExpense: true", usually userId is "company_expense".
          // In that case, we don't refund a user balance.
          
          if (targetUserId && !expense.isCompanyExpense) {
              const userRef = doc(db, "users", targetUserId);
              // Reversing credit: If amount was +1000 (User got +1000), we do -1000.
              // If it was a correction (-1000), we do +1000.
              // So, decrement by expense.amount.
              await updateDoc(userRef, { balance: increment(-expense.amount) });
          }

          toast.success("Gasto rechazado y saldo devuelto.");
          setRejectionModalOpen(false);
          setSelectedExpenseToReject(null);
          // Refresh
          fetchPending();
      } catch (e) {
          console.error("Error rejecting:", e);
          toast.error("Error al rechazar");
      }
  };
  
  const handleViewReceipt = (url) => {
      if (!url) {
          toast.error("No hay comprobante adjunto.");
          return;
      }
      window.open(url, '_blank');
  };
  
  if (loading) return <Layout title="Aprobaciones"><p>Cargando...</p></Layout>;

  return (
    <Layout title="Aprobaciones Pendientes">
      <div className="flex flex-col md:flex-row justify-end items-end gap-4 mb-4">
          <div className="flex gap-2 items-center">
              <div>
                  <label className="block text-xs text-gray-500 font-bold mb-1">Desde</label>
                  <input 
                      type="date" 
                      value={startDate} 
                      onChange={e => setStartDate(e.target.value)}
                      className="border border-gray-300 rounded p-2 text-sm"
                  />
              </div>
              <div>
                  <label className="block text-xs text-gray-500 font-bold mb-1">Hasta</label>
                  <input 
                      type="date" 
                      value={endDate} 
                      onChange={e => setEndDate(e.target.value)}
                      className="border border-gray-300 rounded p-2 text-sm"
                  />
              </div>
          </div>
          <button 
              onClick={handleExportCSV}
              className="bg-gray-800 text-white px-4 py-2 rounded flex items-center hover:bg-gray-700 transition"
          >
              <Download className="w-4 h-4 mr-2" />
              Exportar Histórico (CSV)
          </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        {/* TABS */}
        <div className="flex border-b">
            <button 
                onClick={() => setViewMode('pending')}
                className={`px-6 py-3 font-medium text-sm transition-colors ${viewMode === 'pending' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
                Pendientes ({pendingExpenses.length})
            </button>
            <button 
                onClick={() => setViewMode('history')}
                className={`px-6 py-3 font-medium text-sm transition-colors ${viewMode === 'history' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
                Historial de Revisiones ({historyExpenses.length})
            </button>
        </div>

        {(viewMode === 'pending' ? pendingExpenses : historyExpenses).length === 0 ? (
            <div className="p-8 text-center text-gray-500">
                <p>No hay registros en esta vista.</p>
            </div>
        ) : (
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-left">
                    <thead>
                        <tr className="bg-gray-50 border-b">
                            <th className="px-6 py-3 font-medium text-gray-500">Fecha</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Profesional</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Proyecto</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Monto</th>
                            {viewMode === 'history' && <th className="px-6 py-3 font-medium text-gray-500">Estado</th>}
                            <th className="px-6 py-3 font-medium text-gray-500">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {(viewMode === 'pending' ? pendingExpenses : historyExpenses).map((e, index) => (
                            <Motion.tr 
                                key={e.id} 
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.2, delay: index * 0.05 }}
                                className="hover:bg-gray-50 transition-colors"
                            >
                                <td className="px-6 py-4 text-sm text-gray-600">{e.date}</td>
                                <td className="px-6 py-4 font-medium text-gray-800">{e.userName || 'N/A'}</td>
                                <div className="flex flex-col">
                                    <td className="px-6 py-4 text-gray-600 text-sm font-medium">{e.projectName || 'N/A'}</td>
                                    <span className="px-6 text-xs text-gray-400">{e.description}</span>
                                </div>
                                <td className="px-6 py-4 font-semibold">{formatCurrency(e.amount)}</td>
                                {viewMode === 'history' && (
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                                            e.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                        }`}>
                                            {e.status === 'approved' ? 'Aprobado' : 'Rechazado'}
                                        </span>
                                        {e.rejectionReason && <p className="text-xs text-red-500 mt-1 italic">"{e.rejectionReason}"</p>}
                                    </td>
                                )}
                                <td className="px-6 py-4 flex space-x-2">
                                     <button 
                                        onClick={() => handleViewReceipt(e.imageUrl)}
                                        className="text-blue-600 hover:text-blue-800 p-1 hover:bg-blue-50 rounded"
                                        title="Ver Comprobante"
                                    >
                                        <FileText className="w-6 h-6" />
                                    </button>
                                    {viewMode === 'pending' && (
                                        <>
                                            <button 
                                                onClick={() => handleApprove(e)}
                                                className="text-green-600 hover:text-green-800 p-1 hover:bg-green-50 rounded"
                                                title="Aprobar"
                                            >
                                                <CheckCircle className="w-6 h-6" />
                                            </button>
                                            <button 
                                                onClick={() => openRejectionModal(e)}
                                                className="text-red-500 hover:text-red-700 p-1 hover:bg-red-50 rounded"
                                                title="Rechazar"
                                            >
                                                <XCircle className="w-6 h-6" />
                                            </button>
                                        </>
                                    )}
                                </td>
                            </Motion.tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}
      </div>

      <RejectionModal 
          isOpen={rejectionModalOpen}
          onClose={() => setRejectionModalOpen(false)}
          onConfirm={handleConfirmRejection}
          expense={selectedExpenseToReject}
      />
    </Layout>
  );
}
