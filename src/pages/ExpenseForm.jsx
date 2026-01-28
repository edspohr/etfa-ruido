import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { parseReceiptImage } from '../lib/gemini';
import { db, uploadReceiptImage } from '../lib/firebase';
import { collection, getDocs, query, where, doc, increment, writeBatch } from 'firebase/firestore';
import { Upload, Loader2, Camera, X, FileText, Plus } from 'lucide-react';
import { formatCurrency } from '../utils/format'; // Validation aid/display
import { useNavigate } from 'react-router-dom';
import { compressImage } from '../utils/imageUtils';
import { sortProjects } from '../utils/sort';
import { toast } from 'sonner';

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
          setProjects(sortProjects(data));

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
    const originalFile = e.target.files[0];
    if (!originalFile) return;

    setStep('review');

    // AI Processing & Compression
    try {
      setProcessingAi(true);
      
      // 1. Compress Image (if it's an image)
      const compressedFile = await compressImage(originalFile);

      // 2. Set Preview & Data with Compressed File
      const url = URL.createObjectURL(compressedFile);
      setPreviewUrl(url);
      setFormData(prev => ({ ...prev, receiptImage: compressedFile }));

      // 3. Determine available categories based on role
      let availableCats = [...CATEGORIES_COMMON];
      if (userRole === 'admin') {
          availableCats = [...availableCats, ...CATEGORIES_ADMIN];
      }

      // 4. AI Analysis (using compressed file)
      const data = await parseReceiptImage(compressedFile, availableCats);
      if (data) {
        setFormData(prev => ({
          ...prev,
          date: data.date || prev.date,
          merchant: data.merchant || prev.merchant,
          amount: data.amount || prev.amount,
          description: data.description || prev.description,
          category: data.category || prev.category,
        }));
      }
    } catch (err) {
      console.error("Processing Error:", err);
      // Fallback: If compression fails
      if (!formData.receiptImage) {
           setFormData(prev => ({ ...prev, receiptImage: originalFile }));
           setPreviewUrl(URL.createObjectURL(originalFile));
      }
    } finally {
      setProcessingAi(false);
    }
  };

  // Split Logic
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [splitRows, setSplitRows] = useState([{ projectId: '', amount: '' }]);

  // ... (Existing useEffects)

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
      setIsSplitMode(false);
      setSplitRows([{ projectId: '', amount: '' }]);
  };

  const handleAddSplitRow = () => {
      setSplitRows([...splitRows, { projectId: '', amount: '' }]);
  };

  const handleRemoveSplitRow = (index) => {
      const newRows = [...splitRows];
      newRows.splice(index, 1);
      setSplitRows(newRows);
  };

  const handleSplitChange = (index, field, value) => {
      const newRows = [...splitRows];
      newRows[index][field] = value;
      setSplitRows(newRows);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentUser || loading) return;

    // Common Validation
    const totalAmount = Number(formData.amount);
    if (isNaN(totalAmount) || totalAmount === 0) {
        toast.error("Ingrese un monto válido (puede ser negativo para devoluciones/correcciones).");
        return;
    }

    if (isSplitMode) {
        const sumSplits = splitRows.reduce((acc, row) => acc + (Number(row.amount) || 0), 0);
        if (Math.abs(sumSplits - totalAmount) > 1) { // 1 peso tolerance
            toast.error(`La suma de la distribución (${sumSplits}) no coincide con el total (${totalAmount}). Diferencia: ${totalAmount - sumSplits}`);
            return;
        }
        if (splitRows.some(r => !r.projectId)) {
            toast.error("Seleccione proyecto para todas las filas.");
            return;
        }
    } else {
        if (!formData.projectId) {
            toast.error("Por favor selecciona un proyecto.");
            return;
        }
    }
        
    if (!isSplitMode) {
        const selectedProject = projects.find(p => p.id === formData.projectId);
        // RELIABLE CHECK: Use 'type' property first
        const isCajaChica = selectedProject?.type === 'petty_cash';
        
        if (isCajaChica && userRole !== 'admin') {
            toast.error("No tienes permisos para rendir en 'Caja Chica'.");
            return;
        }
    }

    // ---------------------------------------------------------
    // VALIDATIONS
    // ---------------------------------------------------------

    // 1. Date Restriction (Max 60 days old)
    const MAX_DAYS_OLD = 60;
    // Standardize: create date to midnight local (YYYY-MM-DD + T00...)
    const expenseDate = new Date(formData.date + 'T00:00:00'); 
    const today = new Date();
    today.setHours(0,0,0,0);
    
    // Calculate difference in days
    const diffTime = Math.abs(today - expenseDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (expenseDate < today && diffDays > MAX_DAYS_OLD) {
        toast.error(`La fecha del gasto no puede tener más de ${MAX_DAYS_OLD} días de antigüedad.`);
        return;
    }

    // 2. Duplicity Check
    let targetUidCheck = currentUser.uid;
    if (userRole === 'admin' && expenseMode === 'other' && selectedUserId) {
        targetUidCheck = selectedUserId;
    }

    if (!isSplitMode) {
        const dupQuery = query(
            collection(db, "expenses"),
            where("userId", "==", targetUidCheck),
            where("date", "==", formData.date),
            where("amount", "==", totalAmount)
        );
        
        const dupSnap = await getDocs(dupQuery);
        if (!dupSnap.empty) {
            if (!confirm("Parece que ya existe un gasto con esta fecha y monto para este usuario. ¿Estás seguro de que no es un duplicado?")) {
                return;
            }
        }
    }
    // ---------------------------------------------------------

    try {
        setLoading(true);
        
        let imageUrl = '';
        // 1. Upload Image
        if (formData.receiptImage) {
            imageUrl = await uploadReceiptImage(formData.receiptImage, currentUser.uid);
        }

        // Prepare Common Data
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

        // All expenses start as pending, even for admins (Cross-check requirement)
        const initialStatus = 'pending';

        const splitGroupId = isSplitMode ? crypto.randomUUID() : null;
        
        // Define items to save
        let itemsToSave = [];
        if (isSplitMode) {
            itemsToSave = splitRows.map(row => ({
                projectId: row.projectId,
                amount: Number(row.amount)
            }));
        } else {
             itemsToSave = [{
                 projectId: formData.projectId,
                 amount: totalAmount
             }];
        }

        // START BATCH
        const batch = writeBatch(db);

        for (const item of itemsToSave) {
            const projectObj = projects.find(p => p.id === item.projectId);
            const expenseRef = doc(collection(db, "expenses")); // Auto ID

            // 1. Create Expense
            batch.set(expenseRef, {
                userId: targetUid,
                userName: targetName,
                projectId: item.projectId,
                projectName: projectObj?.name || 'Unknown',
                category: formData.category,
                date: formData.date,
                merchant: formData.merchant,
                description: formData.description + (isSplitMode ? ' [Distribución]' : ''),
                amount: item.amount,
                imageUrl: imageUrl,
                status: initialStatus,
                createdAt: new Date().toISOString(),
                isCompanyExpense: isProjectExpense,
                splitGroupId: splitGroupId // Link them
            });

            // 2. Update Project Total (Only if approved immediately, kept for consistency)
            if (initialStatus === 'approved') {
                 const projectRef = doc(db, "projects", item.projectId);
                 batch.update(projectRef, {
                     expenses: increment(item.amount)
                 });
            }

            // 3. Update User Balance (Credit) only if personal/other expense
            if (!isProjectExpense) {
                const userRef = doc(db, "users", targetUid);
                batch.set(userRef, {
                    balance: increment(item.amount)
                }, { merge: true });
            }
        }

        await batch.commit();
        // END BATCH

        toast.success(initialStatus === 'approved' ? "Gasto registrado y aprobado." : "Rendición enviada exitosamente.");
        navigate('/dashboard');

    } catch (e) {
        console.error("Error submitting expense:", e);
        toast.error("Error al enviar la rendición: " + e.message);
    } finally {
        setLoading(false);
    }
  };

  return (
    <Layout title="Nueva Rendición">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-2xl shadow-soft border border-slate-100">
        
        {/* Step 1: Upload or Manual */}
        {step === 'upload' && (
            <div className="space-y-6">
                 <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-2xl p-10 bg-slate-50 hover:bg-slate-100 transition cursor-pointer relative h-72 group">
                    <input 
                        type="file" 
                        accept="image/*,application/pdf" 
                        onChange={handleFileChange} 
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <div className="text-center group-hover:scale-105 transition duration-300">
                        <div className="bg-white p-4 rounded-full shadow-sm mb-4 inline-block">
                            <Camera className="w-12 h-12 text-slate-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-700 mb-2">Subir Boleta</h3>
                        <p className="text-slate-500 text-sm">Toca para tomar foto o seleccionar archivo</p>
                    </div>
                </div>

                <div className="text-center">
                    <span className="text-slate-400 text-sm font-medium">o también puedes</span>
                    <button 
                        onClick={() => setStep('review')}
                        className="block w-full mt-3 bg-white border border-slate-200 text-slate-700 font-bold py-4 px-4 rounded-xl hover:bg-slate-50 transition shadow-sm"
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
                                 <span className="font-medium">Optimizando y Analizando...</span>
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

                    <div className="md:col-span-2 space-y-4">
                        <div className="flex justify-between items-center">
                            <label className="block text-sm font-semibold text-gray-700">Proyecto *</label>
                            {userRole === 'admin' && (
                                <div className="flex items-center">
                                    <input 
                                        type="checkbox" 
                                        id="splitMode"
                                        checked={isSplitMode}
                                        onChange={e => setIsSplitMode(e.target.checked)}
                                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                    />
                                    <label htmlFor="splitMode" className="ml-2 text-sm text-blue-800 font-bold cursor-pointer">
                                        Distribuir gasto (Multi-Proyecto)
                                    </label>
                                </div>
                            )}
                        </div>
                        
                        {!isSplitMode ? (
                            <select 
                                required
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-base focus:ring-2 focus:ring-slate-400 focus:border-transparent outline-none transition"
                                value={formData.projectId}
                                onChange={e => setFormData({...formData, projectId: e.target.value})}
                            >
                                <option value="">Selecciona un proyecto...</option>
                                {projects.map(p => {
                                    if (p.status === 'deleted') return null;
                                    const isCajaChica = (p.name.toLowerCase().includes("caja chica") || p.type === 'petty_cash');
                                    if (isCajaChica && userRole !== 'admin') return null;
                                    return <option key={p.id} value={p.id}>{p.code ? `[${p.code}] ` : ''}{p.recurrence ? `(${p.recurrence}) ` : ''}{p.name}</option>
                                })}
                            </select>
                        ) : (
                            <div className="bg-gray-50 p-4 rounded-lg border border-blue-200">
                                <p className="text-sm text-gray-600 mb-2">
                                    Total a distribuir: <span className="font-bold">{formatCurrency(formData.amount || 0)}</span>
                                </p>
                                {splitRows.map((row, idx) => (
                                    <div key={idx} className="flex gap-2 mb-2 items-start">
                                        <select 
                                            required
                                            className="flex-grow border border-gray-300 rounded p-2 text-sm"
                                            value={row.projectId}
                                            onChange={e => handleSplitChange(idx, 'projectId', e.target.value)}
                                        >
                                            <option value="">Proyecto...</option>
                                            {projects.map(p => (
                                                <option key={p.id} value={p.id}>{p.code ? `[${p.code}] ` : ''}{p.recurrence ? `(${p.recurrence}) ` : ''}{p.name}</option>
                                            ))}
                                        </select>
                                        <input 
                                            type="number"
                                            placeholder="Monto"
                                            className="w-24 border border-gray-300 rounded p-2 text-sm"
                                            value={row.amount}
                                            onChange={e => handleSplitChange(idx, 'amount', e.target.value)}
                                            required
                                        />
                                        {splitRows.length > 1 && (
                                            <button type="button" onClick={() => handleRemoveSplitRow(idx)} className="text-red-500 p-2">
                                                <X className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                                <button type="button" onClick={handleAddSplitRow} className="text-sm text-blue-600 font-bold hover:underline mt-2 flex items-center">
                                    <Plus className="w-4 h-4 mr-1" /> Agregar Fila
                                </button>
                                {(() => {
                                    const sum = splitRows.reduce((a,r) => a + (Number(r.amount)||0), 0);
                                    const diff = (Number(formData.amount)||0) - sum;
                                    return (
                                        <p className={`text-xs mt-2 font-bold ${Math.abs(diff) > 1 ? 'text-red-500' : 'text-green-600'}`}>
                                            {Math.abs(diff) > 1 ? `Faltan asignar: ${formatCurrency(diff)}` : 'Distribución Completa'}
                                        </p>
                                    );
                                })()}
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">Categoría *</label>
                        <select 
                            required
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-base focus:ring-2 focus:ring-slate-400 focus:border-transparent outline-none transition"
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
                        <label className="block text-sm font-bold text-slate-700 mb-2">Fecha</label>
                        <input 
                            type="date" 
                            required
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-base focus:ring-2 focus:ring-slate-400 focus:border-transparent outline-none transition"
                            value={formData.date}
                            onChange={e => setFormData({...formData, date: e.target.value})}
                        />
                    </div>

                     <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">Monto (CLP)</label>
                        <input 
                            type="number" 
                            required
                            placeholder="0"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-base focus:ring-2 focus:ring-slate-400 focus:border-transparent outline-none transition"
                            value={formData.amount}
                            onChange={e => setFormData({...formData, amount: e.target.value})}
                        />
                    </div>

                    <div className="md:col-span-2">
                        <label className="block text-sm font-bold text-slate-700 mb-2">Comercio / Lugar</label>
                        <input 
                            type="text" 
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-base focus:ring-2 focus:ring-slate-400 focus:border-transparent outline-none transition"
                            value={formData.merchant}
                            onChange={e => setFormData({...formData, merchant: e.target.value})}
                            placeholder="Ej: Restaurant El Paso"
                        />
                    </div>

                    <div className="md:col-span-2">
                        <label className="block text-sm font-bold text-slate-700 mb-2">Descripción</label>
                        <textarea 
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-base focus:ring-2 focus:ring-slate-400 focus:border-transparent outline-none transition"
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
                         className="flex-1 bg-slate-100 text-slate-700 font-bold py-4 px-6 rounded-xl hover:bg-slate-200 transition"
                    >
                        Cancelar
                    </button>
                    <button 
                        type="submit"
                        disabled={loading || processingAi}
                        className="flex-1 bg-slate-900 text-white font-bold py-4 px-6 rounded-xl hover:bg-slate-800 transition disabled:opacity-50 shadow-lg hover:shadow-xl text-lg flex justify-center items-center"
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
