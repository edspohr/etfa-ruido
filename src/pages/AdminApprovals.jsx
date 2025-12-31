import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs, doc, updateDoc, increment, writeBatch, orderBy } from 'firebase/firestore';
import { formatCurrency } from '../utils/format';
import { CheckCircle, XCircle, Download, FileText } from 'lucide-react';

export default function AdminApprovals() {
  const [pendingExpenses, setPendingExpenses] = useState([]);
  const [loading, setLoading] = useState(true);

  // ... (fetchPending remains same)

  const fetchPending = async () => {
      try {
          setLoading(true);
          const q = query(collection(db, "expenses"), where("status", "==", "pending"));
          const snapshot = await getDocs(q);
          const data = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
          setPendingExpenses(data);
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
          const expenses = snapshot.docs.map(d => d.data());

          // Define CSV Headers
          const headers = ["Fecha", "Profesional", "Proyecto", "Descripción", "Categoría", "Monto", "Estado"];
          
          // Map Data to CSV Rows
          const rows = expenses.map(e => [
              e.date || "",
              e.userName || "",
              e.projectName || "",
              `"${(e.description || "").replace(/"/g, '""')}"`, // Escape quotes
              e.category || "",
              e.amount || 0,
              e.status === 'approved' ? 'Aprobado' : e.status === 'rejected' ? 'Rechazado' : 'Pendiente'
          ]);

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
          link.setAttribute("download", `rendiciones_etfa_${new Date().toISOString().split('T')[0]}.csv`);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
      } catch (e) {
          console.error("Error exporting CSV:", e);
          alert("Error al exportar los datos.");
      }
  };


  useEffect(() => {
    fetchPending();
  }, []);

  const handleApprove = async (expenseId) => {
      try {
          // Just update status
          await updateDoc(doc(db, "expenses", expenseId), {
              status: "approved"
          });
          fetchPending();
      } catch (e) {
          console.error("Error approving:", e);
          alert("Error al aprobar");
      }
  };

  const handleReject = async (expense) => {
      if (!confirm("¿Rechazar este gasto? El monto será descontado del saldo del usuario.")) return;

      try {
          const batch = writeBatch(db);
          
          // 1. Mark as rejected
          const expenseRef = doc(db, "expenses", expense.id);
          batch.update(expenseRef, { status: "rejected" });

          // 2. Refund User (INVERTED LOGIC: Expense added funds, so Reject removes them)
          if (expense.userId) {
              const userRef = doc(db, "users", expense.userId);
              batch.update(userRef, { balance: increment(-expense.amount) });
          }

          await batch.commit();
          fetchPending();
      } catch (e) {
          console.error("Error rejecting:", e);
          alert("Error al rechazar");
      }
  };
  
  const handleViewReceipt = (url) => {
      if (!url) {
          alert("No hay comprobante adjunto.");
          return;
      }
      window.open(url, '_blank');
  };
  
  if (loading) return <Layout title="Aprobaciones"><p>Cargando...</p></Layout>;

  return (
    <Layout title="Aprobaciones Pendientes">
      <div className="flex justify-end mb-4">
          <button 
              onClick={handleExportCSV}
              className="bg-gray-800 text-white px-4 py-2 rounded flex items-center hover:bg-gray-700 transition"
          >
              <Download className="w-4 h-4 mr-2" />
              Exportar Histórico (CSV)
          </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        {pendingExpenses.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
                <p>No hay rendiciones pendientes de revisión.</p>
            </div>
        ) : (
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead>
                        <tr className="bg-gray-50 border-b">
                            <th className="px-6 py-3 font-medium text-gray-500">Fecha</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Profesional</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Proyecto</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Monto</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {pendingExpenses.map(e => (
                            <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                                <td className="px-6 py-4 text-sm text-gray-600">{e.date}</td>
                                <td className="px-6 py-4 font-medium text-gray-800">{e.userName || 'N/A'}</td>
                                <div className="flex flex-col">
                                    <td className="px-6 py-4 text-gray-600 text-sm font-medium">{e.projectName || 'N/A'}</td>
                                    <span className="px-6 text-xs text-gray-400">{e.description}</span>
                                </div>
                                <td className="px-6 py-4 font-semibold">{formatCurrency(e.amount)}</td>
                                <td className="px-6 py-4 flex space-x-2">
                                     <button 
                                        onClick={() => handleViewReceipt(e.imageUrl)}
                                        className="text-blue-600 hover:text-blue-800 p-1 hover:bg-blue-50 rounded"
                                        title="Ver Comprobante"
                                    >
                                        <FileText className="w-6 h-6" />
                                    </button>
                                    <button 
                                        onClick={() => handleApprove(e.id)}
                                        className="text-green-600 hover:text-green-800 p-1 hover:bg-green-50 rounded"
                                        title="Aprobar"
                                    >
                                        <CheckCircle className="w-6 h-6" />
                                    </button>
                                    <button 
                                        onClick={() => handleReject(e)}
                                        className="text-red-500 hover:text-red-700 p-1 hover:bg-red-50 rounded"
                                        title="Rechazar"
                                    >
                                        <XCircle className="w-6 h-6" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}
      </div>
    </Layout>
  );
}
