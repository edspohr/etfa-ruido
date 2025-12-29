import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { parseReceiptImage } from '../lib/gemini';
import { db } from '../lib/firebase';
import { collection, addDoc, getDocs, query, where, doc, updateDoc, increment } from 'firebase/firestore';
import { Upload, Loader2, Camera } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function ExpenseForm() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState([]);
  
  const [formData, setFormData] = useState({
    projectId: '',
    date: '',
    merchant: '',
    description: '',
    amount: '',
    receiptImage: null
  });
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
      async function fetchProjects() {
          const q = query(collection(db, "projects"), where("status", "==", "active"));
          const snapshot = await getDocs(q);
          const data = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
          setProjects(data);
      }
      fetchProjects();
  }, []);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Create preview
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setFormData(prev => ({ ...prev, receiptImage: file }));

    // AI Processing
    try {
      setLoading(true);
      const data = await parseReceiptImage(file);
      if (data) {
        setFormData(prev => ({
          ...prev,
          date: data.date || prev.date,
          merchant: data.merchant || prev.merchant,
          amount: data.amount || prev.amount,
          description: data.description || prev.description,
          receiptImage: file
        }));
      }
    } catch (err) {
      console.error("AI Error:", err);
      alert("Error al procesar la imagen con IA. Por favor ingrese los datos manualmente.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.projectId) {
        alert("Por favor selecciona un proyecto.");
        return;
    }
    if (!currentUser) return;

    try {
        setLoading(true);
        
        // 1. Find Project Name
        const selectedProject = projects.find(p => p.id === formData.projectId);

        // 2. Save Expense
        await addDoc(collection(db, "expenses"), {
            userId: currentUser.uid,
            userName: currentUser.displayName,
            projectId: formData.projectId,
            projectName: selectedProject?.name || 'Unknown',
            date: formData.date,
            merchant: formData.merchant,
            description: formData.description,
            amount: Number(formData.amount),
            status: "pending",
            createdAt: new Date().toISOString()
            // In a real app we would upload the image to Storage here and save the URL
        });

        // 3. Deduct Balance
        const userRef = doc(db, "users", currentUser.uid);
        await updateDoc(userRef, {
            balance: increment(-Number(formData.amount))
        });

        alert("Rendición enviada exitosamente.");
        navigate('/dashboard');

    } catch (e) {
        console.error("Error submitting expense:", e);
        alert("Error al enviar la rendición.");
    } finally {
        setLoading(false);
    }
  };

  return (
    <Layout title="Nueva Rendición">
      <div className="max-w-2xl mx-auto bg-white p-6 rounded-lg shadow-sm">
        <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* Image Upload */}
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-6 bg-gray-50 hover:bg-gray-100 transition cursor-pointer relative">
                <input 
                    type="file" 
                    accept="image/*" 
                    onChange={handleFileChange} 
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                
                {loading ? (
                    <div className="text-center">
                         <Loader2 className="w-10 h-10 text-blue-600 animate-spin mb-2 mx-auto" />
                         <p className="text-sm text-blue-600 font-medium">Analizando boleta con IA...</p>
                    </div>
                ) : previewUrl ? (
                    <div className="relative w-full">
                         <img src={previewUrl} alt="Receipt Preview" className="max-h-64 mx-auto rounded shadow-sm" />
                         <p className="text-xs text-center text-gray-500 mt-2">Toque para cambiar imagen</p>
                    </div>
                ) : (
                    <div className="text-center">
                        <Camera className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                        <p className="text-gray-600 font-medium">Subir foto de boleta</p>
                        <p className="text-xs text-gray-400">La IA intentará leer los datos automáticamente</p>
                    </div>
                )}
            </div>

            {/* Form Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Proyecto *</label>
                    <select 
                        required
                        className="w-full border border-gray-300 rounded-lg p-3 text-base focus:ring-blue-500 focus:border-blue-500 bg-white"
                        value={formData.projectId}
                        onChange={e => setFormData({...formData, projectId: e.target.value})}
                    >
                        <option value="">Selecciona un proyecto...</option>
                        {projects.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Fecha</label>
                    <input 
                        type="date" 
                        required
                        className="w-full border border-gray-300 rounded-lg p-3 text-base"
                        value={formData.date}
                        onChange={e => setFormData({...formData, date: e.target.value})}
                    />
                </div>

                 <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Monto (CLP)</label>
                    <input 
                        type="number" 
                        required
                        placeholder="0"
                        className="w-full border border-gray-300 rounded-lg p-3 text-base"
                        value={formData.amount}
                        onChange={e => setFormData({...formData, amount: e.target.value})}
                    />
                </div>

                <div className="md:col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Comercio / Lugar</label>
                    <input 
                        type="text" 
                        className="w-full border border-gray-300 rounded-lg p-3 text-base"
                        value={formData.merchant}
                        onChange={e => setFormData({...formData, merchant: e.target.value})}
                        placeholder="Ej: Restaurant El Paso"
                    />
                </div>

                <div className="md:col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Descripción</label>
                    <textarea 
                        className="w-full border border-gray-300 rounded-lg p-3 text-base"
                        rows="3"
                        value={formData.description}
                        onChange={e => setFormData({...formData, description: e.target.value})}
                        placeholder="Detalle del gasto..."
                    ></textarea>
                </div>
            </div>

            <button 
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 text-white font-bold py-4 px-6 rounded-xl hover:bg-blue-700 transition disabled:opacity-50 shadow-lg text-lg"
            >
                {loading ? 'Enviando...' : 'Enviar Rendición'}
            </button>
        </form>
      </div>
    </Layout>
  );
}
