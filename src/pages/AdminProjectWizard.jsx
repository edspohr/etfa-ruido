import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  collection, 
  addDoc, 
  updateDoc, 
  doc, 
  getDocs, 
  query, 
  where, 
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { toast } from 'sonner';
import { 
  ChevronRight, 
  ChevronLeft, 
  Check, 
  User, 
  Phone, 
  Mail, 
  Briefcase, 
  Truck, 
  HardHat,
  ChevronDown
} from 'lucide-react';

import Layout from '../components/Layout';
import SearchableSelect from '../components/SearchableSelect';

/**
 * Indicador de pasos del Wizard.
 */
const StepIndicator = ({ currentStep, completedSteps }) => {
  const steps = [1, 2, 3];
  return (
    <div className="flex items-center justify-center mb-10">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center">
          <div className="flex flex-col items-center relative">
            <div className={`
              w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all duration-500
              ${currentStep === s 
                ? 'bg-indigo-600 border-indigo-600 text-white shadow-xl shadow-indigo-500/30 scale-110' 
                : completedSteps.includes(s) 
                  ? 'bg-teal-500 border-teal-500 text-white' 
                  : 'bg-slate-800 border-slate-700 text-slate-500'}
            `}>
              {completedSteps.includes(s) ? <Check className="w-6 h-6" /> : s}
            </div>
            <span className={`
              absolute -bottom-7 text-[10px] uppercase tracking-widest font-black transition-colors duration-300
              ${currentStep === s ? 'text-indigo-400' : 'text-slate-500'}
            `}>
              {s === 1 ? 'Básico' : s === 2 ? 'Contacto' : 'Recursos'}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`w-16 h-0.5 mx-3 transition-colors duration-500 ${completedSteps.includes(s) ? 'bg-teal-500' : 'bg-slate-700'}`} />
          )}
        </div>
      ))}
    </div>
  );
};

export default function AdminProjectWizard() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState([]);
  const [docId, setDocId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [clients, setClients] = useState([]);
  const [engineersList, setEngineersList] = useState([]);
  const [showEngDropdown, setShowEngDropdown] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    code: '',
    client: '',
    recurrence: '',
    // Step 2
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    contactPosition: '',
    // Step 3
    engineers: [],
    vehicle: '',
    equipment: '',
  });

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [clientsSnap, usersSnap, projectsSnap] = await Promise.all([
          getDocs(collection(db, 'clients')),
          getDocs(query(collection(db, 'users'), where('role', 'in', ['professional', 'admin']))),
          getDocs(collection(db, 'projects')),
        ]);

        // 1. Formal registry clients
        const registeredClients = clientsSnap.docs.map(d => ({
          value: d.data().razonSocial || d.id,
          label: d.data().razonSocial || 'Sin nombre',
        }));

        // 2. Historical clients from projects
        const projectClients = [...new Set(projectsSnap.docs.map(d => d.data().client).filter(Boolean))].map(name => ({
          value: name,
          label: name,
        }));

        // 3. Merge and deduplicate
        const combined = [...registeredClients, ...projectClients];
        const uniqueMap = new Map();
        combined.forEach(c => {
          const key = c.value.toLowerCase().trim();
          if (!uniqueMap.has(key)) uniqueMap.set(key, c);
        });
        
        const finalClients = Array.from(uniqueMap.values())
          .sort((a, b) => a.label.localeCompare(b.label));

        setClients(finalClients);

        const engs = usersSnap.docs.map(d => ({
          id: d.id,
          displayName: d.data().displayName || d.data().email || 'Usuario',
        }));
        setEngineersList(engs);
      } catch (error) {
        console.error("Error al cargar datos:", error);
        toast.error("Error al cargar datos necesarios.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleClientSelect = (val) => {
    setFormData(prev => ({ ...prev, client: val }));
  };

  const toggleEngineer = (uid) => {
    setFormData(prev => ({
      ...prev,
      engineers: prev.engineers.includes(uid)
        ? prev.engineers.filter(id => id !== uid)
        : [...prev.engineers, uid]
    }));
  };

  // ── Acciones de Guardado ────────────────────────────────────────────────────

  const saveStep1 = async (shouldExit = false) => {
    if (!formData.name.trim()) {
      toast.error("El nombre del proyecto es obligatorio.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        code: formData.code,
        client: formData.client,
        recurrence: formData.recurrence,
        status: "active",
        billingStatus: "pending",
        expenses: 0,
        createdAt: serverTimestamp(),
      };

      let newId = docId;
      if (!newId) {
        const docRef = await addDoc(collection(db, "projects"), payload);
        newId = docRef.id;
        setDocId(newId);
      } else {
        await updateDoc(doc(db, "projects", newId), payload);
      }

      toast.success("Información básica guardada.");
      setCompletedSteps(prev => [...new Set([...prev, 1])]);

      if (shouldExit) {
        navigate('/admin/projects');
      } else {
        setCurrentStep(2);
      }
    } catch (error) {
      console.error(error);
      toast.error("Error al guardar. Intenta nuevamente.");
    } finally {
      setSaving(false);
    }
  };

  const saveStep2 = async (shouldExit = false) => {
    setSaving(true);
    try {
      await updateDoc(doc(db, "projects", docId), {
        contactName: formData.contactName,
        contactPhone: formData.contactPhone,
        contactEmail: formData.contactEmail,
        contactPosition: formData.contactPosition,
      });

      toast.success("Contacto de cliente actualizado.");
      setCompletedSteps(prev => [...new Set([...prev, 2])]);

      if (shouldExit) {
        navigate('/admin/projects');
      } else {
        setCurrentStep(3);
      }
    } catch (error) {
      console.error(error);
      toast.error("Error al guardar. Intenta nuevamente.");
    } finally {
      setSaving(false);
    }
  };

  const saveStep3 = async (shouldExit = false) => {
    setSaving(true);
    try {
      await updateDoc(doc(db, "projects", docId), {
        engineers: formData.engineers,
        vehicle: formData.vehicle,
        equipment: formData.equipment,
      });

      toast.success("Recursos actualizados.");
      setCompletedSteps(prev => [...new Set([...prev, 3])]);

      if (shouldExit || currentStep === 3) {
        navigate('/admin/projects');
      }
    } catch (error) {
      console.error(error);
      toast.error("Error al guardar. Intenta nuevamente.");
    } finally {
      setSaving(false);
    }
  };

  const omitStep = (stepNumber) => {
    if (stepNumber === 2) setCurrentStep(3);
    if (stepNumber === 3) navigate('/admin/projects');
  };

  // ── Renders ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Layout title="Nuevo Proyecto">
        <div className="flex items-center justify-center h-64">
          <p className="text-slate-400 animate-pulse">Cargando datos...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Nuevo Proyecto">
      <div className="max-w-3xl mx-auto px-4 py-8">
        
        <StepIndicator currentStep={currentStep} completedSteps={completedSteps} />

        {/* STEP 1: INFORMACIÓN BÁSICA */}
        {currentStep === 1 && (
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <Check className="w-5 h-5 text-indigo-500" />
              Información Básica
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-slate-300 mb-2">Nombre del proyecto *</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  placeholder="Ej: Medición de Ruido Planta Central"
                  className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">Código</label>
                <input
                  type="text"
                  name="code"
                  value={formData.code}
                  onChange={handleInputChange}
                  placeholder="Ej: ETF-001"
                  className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">Recurrencia</label>
                <input
                  type="text"
                  name="recurrence"
                  value={formData.recurrence}
                  onChange={handleInputChange}
                  placeholder="Ej: A, B, C..."
                  className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-slate-300 mb-2">Cliente</label>
                <SearchableSelect
                  options={clients}
                  value={formData.client}
                  onChange={handleClientSelect}
                  placeholder="Buscar o seleccionar cliente..."
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-6 border-t border-slate-700">
              <button
                type="button"
                onClick={() => saveStep1(true)}
                disabled={saving}
                className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50"
              >
                Guardar y salir
              </button>
              <button
                type="button"
                onClick={() => saveStep1(false)}
                disabled={saving}
                className="flex items-center gap-2 px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-500/20 transition-all active:scale-95 disabled:opacity-50"
              >
                {saving ? "Guardando..." : "Guardar y continuar"}
                {!saving && <ChevronRight className="w-5 h-5" />}
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: CONTACTO DEL CLIENTE */}
        {currentStep === 2 && (
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-2xl animate-in fade-in slide-in-from-right-4 duration-500">
            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <User className="w-5 h-5 text-indigo-500" />
              Contacto del Cliente (Opcional)
            </h3>

            <div className="space-y-6 mb-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-2">
                    <User className="w-4 h-4" /> Nombre de contacto
                  </label>
                  <input
                    type="text"
                    name="contactName"
                    value={formData.contactName}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  />
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-2">
                    <Phone className="w-4 h-4" /> Teléfono / WhatsApp
                  </label>
                  <input
                    type="text"
                    name="contactPhone"
                    value={formData.contactPhone}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  />
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-2">
                    <Mail className="w-4 h-4" /> Email
                  </label>
                  <input
                    type="email"
                    name="contactEmail"
                    value={formData.contactEmail}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  />
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-2">
                    <Briefcase className="w-4 h-4" /> Cargo
                  </label>
                  <input
                    type="text"
                    name="contactPosition"
                    value={formData.contactPosition}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-6 border-t border-slate-700">
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                className="flex items-center gap-2 px-5 py-3 text-slate-400 hover:text-white font-bold transition-colors"
              >
                <ChevronLeft className="w-5 h-5" /> Anterior
              </button>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => omitStep(2)}
                  className="px-5 py-3 text-slate-400 hover:text-indigo-400 font-bold transition-colors"
                >
                  Omitir este paso
                </button>
                <button
                  type="button"
                  onClick={() => saveStep2(true)}
                  disabled={saving}
                  className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm font-bold transition-all"
                >
                  Guardar y salir
                </button>
                <button
                  type="button"
                  onClick={() => saveStep2(false)}
                  disabled={saving}
                  className="flex items-center gap-2 px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold transition-all shadow-lg active:scale-95 disabled:opacity-50"
                >
                  {saving ? "Guardando..." : "Guardar y continuar"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: RECURSOS */}
        {currentStep === 3 && (
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-2xl animate-in fade-in slide-in-from-right-4 duration-500">
            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <HardHat className="w-5 h-5 text-indigo-500" />
              Recursos (Opcional)
            </h3>

            <div className="space-y-6 mb-8">
              {/* Ingenieros Multi-select */}
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">Ingenieros</label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowEngDropdown(prev => !prev)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm text-left focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  >
                    <span>
                      {formData.engineers.length === 0 
                        ? "Seleccionar ingenieros..." 
                        : `${formData.engineers.length} seleccionado(s)`}
                    </span>
                    <ChevronDown className={`w-5 h-5 text-slate-500 transition-transform ${showEngDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {showEngDropdown && (
                    <div className="absolute z-50 w-full mt-2 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-h-56 overflow-y-auto">
                      {engineersList.map(eng => (
                        <label key={eng.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-800 cursor-pointer transition-colors border-b border-slate-800 last:border-0">
                          <input
                            type="checkbox"
                            checked={formData.engineers.includes(eng.id)}
                            onChange={() => toggleEngineer(eng.id)}
                            className="w-5 h-5 rounded border-slate-600 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-900"
                          />
                          <span className="text-slate-200 text-sm font-medium">{eng.displayName}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                {formData.engineers.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {formData.engineers.map(id => {
                      const name = engineersList.find(e => e.id === id)?.displayName || id;
                      return (
                        <span key={id} className="inline-flex items-center px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-[11px] font-bold text-indigo-300">
                          {name}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-2">
                  <Truck className="w-4 h-4" /> Vehículo
                </label>
                <input
                  type="text"
                  name="vehicle"
                  value={formData.vehicle}
                  onChange={handleInputChange}
                  placeholder="Ej: Camioneta ETF-1"
                  className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                />
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-2">
                  <HardHat className="w-4 h-4" /> Equipamiento
                </label>
                <input
                  type="text"
                  name="equipment"
                  value={formData.equipment}
                  onChange={handleInputChange}
                  placeholder="Ej: Sonómetro Class 1"
                  className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-6 border-t border-slate-700">
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="flex items-center gap-2 px-5 py-3 text-slate-400 hover:text-white font-bold transition-colors"
              >
                <ChevronLeft className="w-5 h-5" /> Anterior
              </button>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => omitStep(3)}
                  className="px-5 py-3 text-slate-400 hover:text-indigo-400 font-bold transition-colors"
                >
                  Omitir este paso
                </button>
                <button
                  type="button"
                  onClick={() => saveStep3(true)}
                  disabled={saving}
                  className="px-10 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-sm font-black transition-all shadow-lg shadow-teal-500/20 active:scale-95 disabled:opacity-50"
                >
                  {saving ? "Guardando..." : "Finalizar y Crear"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
