import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { parseReceiptImage } from '../lib/gemini';
import { db, uploadReceiptImage } from '../lib/firebase';
import { collection, addDoc, getDocs, query, where, doc, updateDoc, increment } from 'firebase/firestore';
import { Upload, Loader2, Camera, X, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const CATEGORIES_COMMON = [
  "Alimentación",
  "Snacks",
  "Combustible", 
  "Traslados", 
  "Materiales", 
  "Otros"
];

const CATEGORIES_ADMIN = [
  "Pasajes Aéreo",
  "Arriendo de Autos",
  "Arriendo de Equipamiento"
];

export default function ExpenseForm() {
  const { currentUser, userRole } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [processingAi, setProcessingAi] = useState(false);
  const [projects, setProjects] = useState([]);
  
  const [step, setStep] = useState('upload'); // 'upload' | 'review'
  
  // Admin "On Behalf Of" State
  const [expenseMode, setExpenseMode] = useState('me'); // 'me', 'project', 'other'
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');

  const [formData, setFormData] = useState({
    projectId: '',
    date: '',
    merchant: '',
    description: '',
    category: '',
    amount: '',
    receiptImage: null
  });
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
      async function fetchData() {
          // Fetch Projects
          const q = query(collection(db, "projects"), where("status", "!=", "deleted"));
          const snapshot = await getDocs(q);
          const data = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
          setProjects(data);

          // Fetch Users (If Admin)
          if (userRole === 'admin') {
              const uQuery = query(collection(db, "users"), where("role", "==", "professional"));
              const uSnap = await getDocs(uQuery);
              const uData = uSnap.docs.map(d => ({id: d.id, ...d.data()}));
              setUsers(uData);
          }
      }
      if (userRole !== null) { // Wait for role to be known
          fetchData();
      }
  }, [userRole]);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Create preview
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setFormData(prev => ({ ...prev, receiptImage: file }));
    setStep('review');

    // AI Processing
    try {
      setProcessingAi(true);
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
      // We don't block the user, just log the error. User can edit manually.
    } finally {
      setProcessingAi(false);
    }
  };

  const handleCancel = () => {
      setStep('upload');
      setFormData({
        projectId: '',
        date: '',
        merchant: '',
        description: '',
        category: '',
        amount: '',
        receiptImage: null
      });
      setPreviewUrl(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    // Validation
    if (!formData.projectId) {
        alert("Por favor selecciona un proyecto.");
        return;
    }
    
    // "Caja Chica" Check
    const selectedProject = projects.find(p => p.id === formData.projectId);
    const isCajaChica = selectedProject?.name?.toLowerCase().includes("caja chica") || selectedProject?.type === 'petty_cash';
    
    if (isCajaChica && userRole !== 'admin') {
        alert("No tienes permisos para rendir en 'Caja Chica'.");
        return;
    }

    try {
        setLoading(true);
        
        let imageUrl = '';
        // 1. Upload Image
        if (formData.receiptImage) {
            imageUrl = await uploadReceiptImage(formData.receiptImage, currentUser.uid);
        }

        // 2. Save Expense
        const amountNum = Number(formData.amount);
        
        let targetUid = currentUser.uid;
        let targetName = currentUser.displayName;
        let isProjectExpense = false;

        // Determine Logic based on Mode
        if (userRole === 'admin') {
            if (expenseMode === 'project') {
                targetUid = 'company_expense';
                targetName = 'Gasto Empresa';
                isProjectExpense = true;
            } else if (expenseMode === 'other') {
                if (!selectedUserId) { alert("Seleccione un profesional."); setLoading(false); return; }
                const selUser = users.find(u => u.id === selectedUserId);
                targetUid = selUser.id;
                targetName = selUser.displayName;
            }
        }
        
        // Determine Status: Auto-approve if Admin submitting for Project/Company
        const initialStatus = (userRole === 'admin' && expenseMode === 'project') ? 'approved' : 'pending';

        await addDoc(collection(db, "expenses"), {
            userId: targetUid,
            userName: targetName,
            projectId: formData.projectId,
            projectName: selectedProject?.name || 'Unknown',
            category: formData.category,
            date: formData.date,
            merchant: formData.merchant,
            description: formData.description,
            amount: amountNum,
            imageUrl: imageUrl,
            status: initialStatus,
            createdAt: new Date().toISOString(),
            isCompanyExpense: isProjectExpense
        });

        // 3. Side Effects
        // A. If Company/Project Expense AND Approved (Admin): Increment Project Total immediately
        if (isProjectExpense && initialStatus === 'approved') {
             const projectRef = doc(db, "projects", formData.projectId);
             await updateDoc(projectRef, {
                 expenses: increment(amountNum)
             });
        }
        
        // B. If Personal/Other User Expense: Update User Balance (Credit them immediately)
        if (!isProjectExpense) {
            // Logic: Is it Caja Chica?
            const targetBalanceId = isCajaChica ? 'user_caja_chica' : targetUid;
            const userRef = doc(db, "users", targetBalanceId);
            
            await updateDoc(userRef, {
                balance: increment(amountNum)
            });
        }

        alert(initialStatus === 'approved' ? "Gasto registrado y aprobado." : "Rendición enviada exitosamente.");
        navigate('/dashboard');

    } catch (e) {
        console.error("Error submitting expense:", e);
        alert("Error al enviar la rendición: " + e.message);
    } finally {
        setLoading(false);
    }
  };

  return (
    <Layout title="Nueva Rendición">
      <div className="max-w-2xl mx-auto bg-white p-6 rounded-lg shadow-sm">
        
        {/* Step 1: Upload or Manual */}
        {step === 'upload' && (
            <div className="space-y-4">
                 <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-10 bg-gray-50 hover:bg-gray-100 transition cursor-pointer relative h-64">
                    <input 
                        type="file" 
                        accept="image/*,application/pdf" 
                        onChange={handleFileChange} 
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div className="text-center">
                        <Camera className="w-16 h-16 text-blue-500 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-gray-700 mb-2">Subir Boleta (Foto o PDF)</h3>
                        <p className="text-gray-500">Toca aquí para subir archivo</p>
                    </div>
                </div>

                <div className="text-center">
                    <span className="text-gray-400 text-sm">o también puedes</span>
                    <button 
                        onClick={() => setStep('review')}
                        className="block w-full mt-2 bg-white border border-gray-300 text-gray-700 font-semibold py-3 px-4 rounded-lg hover:bg-gray-50 transition"
                    >
                        Ingresar Manualmente sin Comprobante
                    </button>
                </div>
            </div>
        )}

        {/* Step 2: Review & Edit */}
        {step === 'review' && (
            <form onSubmit={handleSubmit} className="space-y-6">
                
                {/* File Preview */}
                {previewUrl && (
                    <div className="relative rounded-lg overflow-hidden border border-gray-200 bg-gray-100 h-48 flex items-center justify-center">
                         {formData.receiptImage?.type === 'application/pdf' ? (
                             <div className="text-center text-gray-600">
                                 <FileText className="w-16 h-16 mx-auto mb-2 text-red-500" />
                                 <p className="font-medium text-sm">{formData.receiptImage.name}</p>
                             </div>
                         ) : (
                             <img src={previewUrl} alt="Receipt Preview" className="w-full h-full object-contain" />
                         )}
                         
                         <button 
                            type="button"
                            onClick={handleCancel}
                            className="absolute top-2 right-2 bg-white/90 p-2 rounded-full text-gray-700 hover:bg-white shadow-sm"
                         >
                            <X className="w-5 h-5" />
                         </button>
                         {processingAi && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white">
                                 <Loader2 className="w-8 h-8 animate-spin mr-2" />
                                 <span className="font-medium">Procesando con IA...</span>
                            </div>
                         )}
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* ADMIN: Expense Mode Selector */}
                    {userRole === 'admin' && (
                        <div className="md:col-span-2 bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-3">
                            <label className="block text-sm font-bold text-gray-700">¿A nombre de quién es el gasto?</label>
                            
                            <div className="flex flex-wrap gap-4">
                                <label className="flex items-center space-x-2 cursor-pointer">
                                    <input 
                                        type="radio" 
                                        name="expenseMode" 
                                        value="me"
                                        checked={expenseMode === 'me'}
                                        onChange={() => setExpenseMode('me')}
                                        className="text-blue-600 focus:ring-blue-500"
                                    />
                                    <span className="text-gray-900">Mí mismo</span>
                                </label>

                                <label className="flex items-center space-x-2 cursor-pointer">
                                    <input 
                                        type="radio" 
                                        name="expenseMode" 
                                        value="project"
                                        checked={expenseMode === 'project'}
                                        onChange={() => setExpenseMode('project')}
                                        className="text-blue-600 focus:ring-blue-500"
                                    />
                                    <span className="text-gray-900">Empresa / Proyecto</span>
                                </label>

                                <label className="flex items-center space-x-2 cursor-pointer">
                                    <input 
                                        type="radio" 
                                        name="expenseMode" 
                                        value="other"
                                        checked={expenseMode === 'other'}
                                        onChange={() => setExpenseMode('other')}
                                        className="text-blue-600 focus:ring-blue-500"
                                    />
                                    <span className="text-gray-900">Otro Profesional</span>
                                </label>
                            </div>

                            {/* User Select if Mode is 'other' */}
                            {expenseMode === 'other' && (
                                <div className="mt-2 animate-fadeIn">
                                    <select 
                                        className="w-full border border-gray-300 rounded p-2 text-sm"
                                        value={selectedUserId}
                                        onChange={e => setSelectedUserId(e.target.value)}
                                        required
                                    >
                                        <option value="">Seleccionar Profesional...</option>
                                        {users.map(u => (
                                            <option key={u.id} value={u.id}>{u.displayName}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            
                             {expenseMode === 'project' && (
                                <p className="text-xs text-blue-600 mt-1">Este gasto se cargará al proyecto pero no afectará saldos de personas.</p>
                            )}
                        </div>
                    )}

                    <div className="md:col-span-2">
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Proyecto *</label>
                        <select 
                            required
                            className="w-full border border-gray-300 rounded-lg p-3 text-base focus:ring-blue-500 focus:border-blue-500 bg-white"
                            value={formData.projectId}
                            onChange={e => setFormData({...formData, projectId: e.target.value})}
                        >
                            <option value="">Selecciona un proyecto...</option>
                            {projects.map(p => {
                                // Filter Deleted (already done by query but double check)
                                if (p.status === 'deleted') return null;

                                // Filter Caja Chica for Non-Admins
                                const isCajaChica = (p.name.toLowerCase().includes("caja chica") || p.type === 'petty_cash');
                                if (isCajaChica && userRole !== 'admin') return null;
                                
                                return <option key={p.id} value={p.id}>{p.name}</option>
                            })}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Categoría *</label>
                        <select 
                            required
                            className="w-full border border-gray-300 rounded-lg p-3 text-base focus:ring-blue-500 focus:border-blue-500 bg-white"
                            value={formData.category}
                            onChange={e => setFormData({...formData, category: e.target.value})}
                        >
                            <option value="">Seleccionar...</option>
                            <option value="">Seleccionar...</option>
                            {CATEGORIES_COMMON.map(c => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                            {userRole === 'admin' && (
                                <optgroup label="Solo Admin">
                                    {CATEGORIES_ADMIN.map(c => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </optgroup>
                            )}
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

                <div className="flex gap-4">
                    <button 
                         type="button"
                         onClick={handleCancel}
                         className="flex-1 bg-gray-100 text-gray-700 font-bold py-4 px-6 rounded-xl hover:bg-gray-200 transition"
                    >
                        Cancelar
                    </button>
                    <button 
                        type="submit"
                        disabled={loading || processingAi}
                        className="flex-1 bg-blue-600 text-white font-bold py-4 px-6 rounded-xl hover:bg-blue-700 transition disabled:opacity-50 shadow-lg text-lg flex justify-center items-center"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-6 h-6 animate-spin mr-2" />
                                Enviando...
                            </>
                        ) : 'Confirmar y Enviar'}
                    </button>
                </div>
            </form>
        )}
      </div>
    </Layout>
  );
}
