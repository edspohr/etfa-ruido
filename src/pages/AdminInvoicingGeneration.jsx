import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { ArrowLeft, Save, Search, CheckCircle, AlertCircle, Plus, Trash2, Upload, FileText, Loader, RefreshCw } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, addDoc, writeBatch, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { formatCurrency } from '../utils/format';
import { Skeleton } from '../components/Skeleton';
import { useDropzone } from "react-dropzone";
import * as pdfjs from "pdfjs-dist";
import { toast } from 'sonner';

// Configure PDF.js Worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

export default function AdminInvoicingGeneration() {
  const navigate = useNavigate();
  
  // View Mode: 'individual' | 'batch'
  const [generationMode, setGenerationMode] = useState('individual');

  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedProject, setSelectedProject] = useState(null);

  // Client State (RUT lookup logic)
  const [clientData, setClientData] = useState({
      rut: '',
      razonSocial: '',
      direccion: '',
      comuna: '',
      giro: ''
  });
  const [searchingClient, setSearchingClient] = useState(false);

  // New Fields
  const [documentType, setDocumentType] = useState('electronic_invoice');
  const [references, setReferences] = useState({
      oc: '',
      hes: '',
      nota_pedido: ''
  });
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);

  // Invoice Data State
  const [expenses, setExpenses] = useState([]);
  const [selectedExpenses, setSelectedExpenses] = useState([]);
  const [customItems, setCustomItems] = useState([]);
  const [glosa, setGlosa] = useState('');

  // PDF Extraction State
  const [extractionMode, setExtractionMode] = useState(false);
  const [extracting, setExtracting] = useState(false);

  // UI State
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingExpenses, setLoadingExpenses] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Batch Mode State
  const [batchInvoices, setBatchInvoices] = useState([]);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });

  // Fetch Projects on Load
  useEffect(() => {
    async function fetchProjects() {
        try {
            const q = query(collection(db, "projects"), where("status", "!=", "deleted"));
            const snapshot = await getDocs(q);
            const loadedProjects = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            
            // Client-side sort to avoid requiring a composite index in Firestore
            loadedProjects.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            setProjects(loadedProjects);
        } catch (e) {
            console.error("Error fetching projects:", e);
            toast.error("Error cargando proyectos.");
        } finally {
            setLoadingProjects(false);
        }
    }
    fetchProjects();
  }, []);

  // Handle Project Selection & Auto-fill Client (if project has client string)
  useEffect(() => {
      if (selectedProjectId) {
          const project = projects.find(p => p.id === selectedProjectId);
          setSelectedProject(project);
          // If we have a project but no client data yet, maybe try to search by name?
          // For now, let user use RUT.
      } else {
          setSelectedProject(null);
          setExpenses([]);
          setSelectedExpenses([]);
      }
  }, [selectedProjectId, projects]);

  // Fetch Expenses when Project changes
  useEffect(() => {
    if (!selectedProjectId) return;

    async function fetchExpenses() {
        setLoadingExpenses(true);
        try {
            const q = query(
                collection(db, "expenses"), 
                where("projectId", "==", selectedProjectId),
                where("status", "==", "approved")
            );
            
            const snapshot = await getDocs(q);
            const validExpenses = snapshot.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(e => !e.invoiceId);

            setExpenses(validExpenses);
            setSelectedExpenses(validExpenses.map(e => e.id));
        } catch (e) {
            console.error("Error fetching expenses:", e);
            toast.error("Error cargando gastos.");
        } finally {
            setLoadingExpenses(false);
        }
    }

    fetchExpenses();
  }, [selectedProjectId]);

  // Client RUT Lookup
  const handleRutBlur = async () => {
      if (!clientData.rut || clientData.rut.length < 8) return;
      
      setSearchingClient(true);
      try {
          // Normalize RUT (remove dots and dashes if needed, but let's assume they might put them)
          const cleanRut = clientData.rut.replace(/[.-]/g, '').toUpperCase();
          const q = query(collection(db, "clients"), where("rut", "==", cleanRut));
          const snapshot = await getDocs(q);
          
          if (!snapshot.empty) {
              const data = snapshot.docs[0].data();
              setClientData({
                  rut: clientData.rut,
                  razonSocial: data.razonSocial || '',
                  direccion: data.direccion || '',
                  comuna: data.comuna || '',
                  giro: data.giro || ''
              });
              toast.success("Cliente encontrado");
          }
      } catch (e) {
          console.error("Error looking up client:", e);
      } finally {
          setSearchingClient(false);
      }
  };

  // PDF Extraction Logic
  const getPdfText = async (file) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      let fullText = "";
      const maxPages = Math.min(pdf.numPages, 3);

      for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item) => item.str).join(" ");
        fullText += pageText + " ";
      }
      return fullText;
    } catch (e) {
      console.error("Error reading PDF:", e);
      return null;
    }
  };

  const onDrop = useCallback(async (acceptedFiles) => {
    if (acceptedFiles.length === 0) return;
    const file = acceptedFiles[0];
    setExtracting(true);

    try {
        const text = await getPdfText(file);
        if (!text) throw new Error("No se pudo leer el PDF");

        // 1. Try to find Project
        const normalizedText = text.toLowerCase().replace(/\s+/g, " ");
        let matchedProj = null;
        for (const project of projects) {
            if (!project.code) continue;
            const code = project.code.toLowerCase().trim();
            if (normalizedText.includes(code)) {
                matchedProj = project;
                break;
            }
        }

        if (matchedProj) {
            setSelectedProjectId(matchedProj.id);
            toast.success(`Proyecto detectado: ${matchedProj.name}`);
        }

        // 2. Try to extract Amount
        const totalMatch = text.match(/total[\s\S]{0,20}?\$?([\d.,]+)/i);
        if (totalMatch && totalMatch[1]) {
            let s = totalMatch[1].replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "");
            const extractedAmount = parseFloat(s) || 0;
            if (extractedAmount > 0) {
                setCustomItems([{ description: 'Servicios según PDF', amount: extractedAmount }]);
                toast.success(`Monto detectado: ${formatCurrency(extractedAmount)}`);
            }
        }

        // 3. Try to extract RUT (Flexible pattern)
        const rutMatch = text.match(/(\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK])/);
        if (rutMatch) {
            const rawRut = rutMatch[0];
            setClientData(prev => ({ ...prev, rut: rawRut }));
            // Trigger lookup
            const cleanRut = rawRut.replace(/[.-]/g, '').toUpperCase();
            const q = query(collection(db, "clients"), where("rut", "==", cleanRut));
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                const data = snapshot.docs[0].data();
                setClientData({
                    rut: rawRut,
                    razonSocial: data.razonSocial || '',
                    direccion: data.direccion || '',
                    comuna: data.comuna || '',
                    giro: data.giro || ''
                });
            }
        }

        setExtractionMode(false);
    } catch (e) {
        console.error("Extraction error:", e);
        toast.error("Error al extraer datos del PDF.");
    } finally {
        setExtracting(false);
    }
  }, [projects]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, 
    accept: {'application/pdf': ['.pdf']},
    multiple: false
  });

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

  // Save / Generate
  const handleGenerateInvoice = async () => {
      if (!clientData.rut || !clientData.razonSocial) {
          toast.error("RUT y Razón Social son requeridos");
          return;
      }
      setGenerating(true);

      try {
          // 1. Upsert Client
          const cleanRut = clientData.rut.replace(/[.-]/g, '').toUpperCase();
          const clientRef = doc(db, "clients", cleanRut);
          await setDoc(clientRef, {
              ...clientData,
              rut: cleanRut,
              updatedAt: serverTimestamp()
          }, { merge: true });

          // 2. Create Invoice Document
          const invoiceData = {
              clientId: cleanRut,
              clientName: clientData.razonSocial,
              clientRut: clientData.rut,
              clientAddress: clientData.direccion,
              
              projectId: selectedProjectId || 'manual',
              projectName: selectedProject?.name || 'Varios / Sin Proyecto',
              projectRecurrence: selectedProject?.recurrence || 'N/A',
              
              glosa: glosa,
              references: references,
              documentType: documentType,
              
              createdAt: serverTimestamp(),
              issueDate: invoiceDate,
              status: 'issued',
              paymentStatus: 'pending',
              
              totalAmount: totalInvoice,
              totalExpenses: totalExpenses,
              totalCustomItems: totalCustom,
              
              expenseIds: selectedExpenses,
              customItems: customItems,
              
              itemCount: selectedExpenses.length + customItems.length,
              source: 'manual_generation'
          };

          const invoiceRef = await addDoc(collection(db, "invoices"), invoiceData);

          // 3. Update Expenses if any
          if (selectedExpenses.length > 0) {
              const batch = writeBatch(db);
              selectedExpenses.forEach(expId => {
                  const expRef = doc(db, "expenses", expId);
                  batch.update(expRef, { 
                      invoiceId: invoiceRef.id, 
                      invoiceStatus: 'issued',
                      billingStatus: 'invoiced'
                  });
              });
              await batch.commit();
          }

          toast.success("Pre-factura generada exitosamente");
          navigate('/admin/invoicing');
          
      } catch (e) {
          console.error("Error generating invoice:", e);
          toast.error("Ocurrió un error al generar la pre-factura.");
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

  // ========================
  // BATCH MODE LOGIC
  // ========================
  const onDropBatch = useCallback(async (acceptedFiles) => {
    if (acceptedFiles.length === 0) return;
    setBatchProcessing(true);
    setBatchProgress({ current: 0, total: acceptedFiles.length });
    const results = [];

    for (let i = 0; i < acceptedFiles.length; i++) {
      const file = acceptedFiles[i];
      setBatchProgress({ current: i + 1, total: acceptedFiles.length });
      try {
        const text = await getPdfText(file);
        if (!text) {
          results.push({ fileName: file.name, status: 'error', error: 'No se pudo leer', rut: '', razonSocial: '', project: '', amount: 0, include: false });
          continue;
        }

        const normalizedText = text.toLowerCase().replace(/\s+/g, ' ');

        // Find project
        let matchedProject = null;
        for (const project of projects) {
          if (!project.code) continue;
          if (normalizedText.includes(project.code.toLowerCase().trim())) {
            matchedProject = project;
            break;
          }
        }

        // Extract amount
        let extractedAmount = 0;
        const totalMatch = text.match(/total[\s\S]{0,20}?\$?([\d.,]+)/i);
        if (totalMatch && totalMatch[1]) {
          let s = totalMatch[1].replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
          extractedAmount = parseFloat(s) || 0;
        }

        // Extract RUT
        let extractedRut = '';
        let clientName = '';
        const rutMatch = text.match(/(\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK])/);
        if (rutMatch) {
          extractedRut = rutMatch[0];
          // Look up client name
          const cleanRut = extractedRut.replace(/[.-]/g, '').toUpperCase();
          try {
            const q = query(collection(db, 'clients'), where('rut', '==', cleanRut));
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
              clientName = snapshot.docs[0].data().razonSocial || '';
            }
          } catch { /* ignore lookup errors */ }
        }

        results.push({
          fileName: file.name,
          status: 'ok',
          rut: extractedRut,
          razonSocial: clientName,
          project: matchedProject ? matchedProject.name : '',
          projectId: matchedProject ? matchedProject.id : '',
          amount: extractedAmount,
          include: extractedAmount > 0
        });
      } catch (e) {
        results.push({ fileName: file.name, status: 'error', error: e.message, rut: '', razonSocial: '', project: '', amount: 0, include: false });
      }
    }

    setBatchInvoices(results);
    setBatchProcessing(false);
    toast.success(`${results.filter(r => r.status === 'ok').length} de ${acceptedFiles.length} PDFs procesados correctamente.`);
  }, [projects]);

  const { getRootProps: getBatchRootProps, getInputProps: getBatchInputProps, isDragActive: isBatchDragActive } = useDropzone({
    onDrop: onDropBatch,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true
  });

  const handleBatchGenerate = async () => {
    const toGenerate = batchInvoices.filter(inv => inv.include && inv.status === 'ok');
    if (toGenerate.length === 0) {
      toast.error('No hay documentos seleccionados para generar.');
      return;
    }
    setBatchSaving(true);
    let successCount = 0;

    try {
      for (const inv of toGenerate) {
        // Upsert client if RUT is present
        if (inv.rut) {
          const cleanRut = inv.rut.replace(/[.-]/g, '').toUpperCase();
          const clientRef = doc(db, 'clients', cleanRut);
          await setDoc(clientRef, {
            rut: cleanRut,
            razonSocial: inv.razonSocial || '',
            updatedAt: serverTimestamp()
          }, { merge: true });
        }

        const invoiceData = {
          clientId: inv.rut ? inv.rut.replace(/[.-]/g, '').toUpperCase() : 'desconocido',
          clientName: inv.razonSocial || 'Sin Razón Social',
          clientRut: inv.rut || '',
          projectId: inv.projectId || 'manual',
          projectName: inv.project || 'Varios / Sin Proyecto',
          glosa: `Generado desde: ${inv.fileName}`,
          documentType: 'electronic_invoice',
          createdAt: serverTimestamp(),
          issueDate: new Date().toISOString().split('T')[0],
          status: 'issued',
          paymentStatus: 'pending',
          totalAmount: inv.amount,
          totalExpenses: 0,
          totalCustomItems: inv.amount,
          expenseIds: [],
          customItems: [{ description: `Servicios según ${inv.fileName}`, amount: inv.amount }],
          itemCount: 1,
          source: 'batch_pdf'
        };

        await addDoc(collection(db, 'invoices'), invoiceData);
        successCount++;
      }

      toast.success(`${successCount} pre-facturas generadas exitosamente.`);
      navigate('/admin/invoicing');
    } catch (e) {
      console.error('Batch generation error:', e);
      toast.error(`Error: se generaron ${successCount} de ${toGenerate.length}.`);
    } finally {
      setBatchSaving(false);
    }
  };

  const updateBatchInvoice = (index, field, value) => {
    setBatchInvoices(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  return (
    <Layout title="Generar Pre-Factura">
      <div className="mb-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
            <Link 
                to="/admin/invoicing" 
                className="inline-flex items-center text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-indigo-600 transition-colors mb-2 group"
            >
                <ArrowLeft className="w-4 h-4 mr-1 group-hover:-translate-x-1 transition-transform" /> 
                Volver al Dashboard
            </Link>
            <h1 className="text-3xl font-black text-slate-800 tracking-tight">Generar Pre-Facturas</h1>
            <p className="text-sm text-slate-500 mt-1 font-medium">Crea documentos manualmente o procesa PDFs en lote.</p>
        </div>
      </div>
      
      {/* Mode Switcher */}
      <div className="flex bg-slate-200/50 p-1 rounded-xl mb-8 w-fit border border-slate-200">
          <button 
              onClick={() => setGenerationMode('individual')}
              className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${generationMode === 'individual' ? 'bg-white text-indigo-700 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}
          >
              Individual / Manual
          </button>
          <button 
              onClick={() => setGenerationMode('batch')}
              className={`px-6 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${generationMode === 'batch' ? 'bg-white text-indigo-700 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}
          >
              <Upload className="w-4 h-4" /> Carga Múltiple (Lote)
          </button>
      </div>

      {generationMode === 'individual' && (
        <>
          {extractionMode && (
              <div className="mb-8 relative overflow-hidden rounded-3xl animate-in fade-in slide-in-from-top-4 duration-300">
                  <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/50 to-blue-50/50 -z-10" />
                  <div className={`
                      border-2 border-dashed rounded-3xl p-10 text-center transition-all duration-300
                      ${isDragActive ? 'border-indigo-500 bg-indigo-50/80 scale-[1.01] shadow-lg shadow-indigo-100' : 'border-indigo-200 hover:border-indigo-400 hover:bg-white'}
                  `}>
                      <button 
                          onClick={() => setExtractionMode(false)} 
                          className="absolute top-4 right-4 text-slate-400 hover:text-rose-500 hover:bg-rose-50 p-2 rounded-full transition-all"
                          title="Cancelar Carga"
                      >
                          <Trash2 className="w-5 h-5" />
                      </button>
                      <div {...getRootProps()} className="cursor-pointer outline-none">
                          <input {...getInputProps()} />
                          <div className={`
                              w-20 h-20 mx-auto mb-4 rounded-2xl flex items-center justify-center transition-all duration-300
                              ${isDragActive ? 'bg-indigo-600 text-white scale-110 shadow-lg shadow-indigo-200' : 'bg-indigo-100 text-indigo-500 group-hover:bg-indigo-200'}
                          `}>
                              <FileText className="w-10 h-10" />
                          </div>
                          <h3 className="text-xl font-bold text-slate-800 mb-2">
                              {isDragActive ? '¡Suéltalo aquí!' : 'Sube tu archivo PDF'}
                          </h3>
                          <p className="text-slate-500 text-sm max-w-sm mx-auto font-medium">
                              Arrastra y suelta el documento, o haz clic para explorar. 
                              Extraeremos RUT, Proyecto y Montos.
                          </p>
                      </div>
                  </div>
              </div>
          )}

          {extracting && (
              <div className="mb-8 bg-white border border-indigo-100 shadow-xl shadow-indigo-100/50 rounded-3xl p-10 text-center relative overflow-hidden animate-in fade-in zoom-in-95 duration-300">
                  <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] opacity-5 -z-10" />
                  <div className="relative">
                      <div className="w-20 h-20 mx-auto bg-indigo-50 rounded-2xl flex items-center justify-center mb-6 relative">
                          <div className="absolute inset-0 border-4 border-indigo-100 rounded-2xl animate-pulse"></div>
                          <Loader className="w-10 h-10 text-indigo-600 animate-spin" />
                      </div>
                      <h3 className="text-xl font-black text-slate-800 mb-2">Analizando Documento</h3>
                      <p className="text-slate-500 font-medium">Aplicando OCR y extrayendo campos clave...</p>
                  </div>
              </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Client & Project */}
          <div className="lg:col-span-1 space-y-6">
              
              {/* Client Details */}
              <div className="bg-white p-8 rounded-[2rem] shadow-lg shadow-slate-200/40 border border-slate-200/60 transition-all hover:shadow-xl hover:shadow-slate-200/50">
                  <div className="flex items-center gap-3 mb-6">
                      <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-sm">1</div>
                      <h3 className="font-bold text-lg text-slate-800">Datos del Cliente</h3>
                  </div>
                  
                  <div className="space-y-4">
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">RUT</label>
                          <div className="relative">
                              <input 
                                  type="text"
                                  className="w-full p-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm font-mono transition-all hover:border-slate-300 bg-slate-50/50 focus:bg-white"
                                  placeholder="12.345.678-9"
                                  value={clientData.rut}
                                  onChange={e => setClientData({...clientData, rut: e.target.value})}
                                  onBlur={handleRutBlur}
                              />
                              {searchingClient && <Loader className="w-4 h-4 absolute right-3 top-2.5 animate-spin text-indigo-500" />}
                          </div>
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Razón Social</label>
                          <input 
                              type="text"
                              className="w-full p-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm transition-all hover:border-slate-300 bg-slate-50/50 focus:bg-white"
                              placeholder="Nombre de la empresa"
                              value={clientData.razonSocial}
                              onChange={e => setClientData({...clientData, razonSocial: e.target.value})}
                          />
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Dirección</label>
                          <input 
                              type="text"
                              className="w-full p-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm transition-all hover:border-slate-300 bg-slate-50/50 focus:bg-white"
                              placeholder="Av. Principal 123"
                              value={clientData.direccion}
                              onChange={e => setClientData({...clientData, direccion: e.target.value})}
                          />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Comuna</label>
                            <input 
                                type="text"
                                className="w-full p-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm transition-all hover:border-slate-300 bg-slate-50/50 focus:bg-white"
                                value={clientData.comuna}
                                onChange={e => setClientData({...clientData, comuna: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Giro</label>
                            <input 
                                type="text"
                                className="w-full p-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm transition-all hover:border-slate-300 bg-slate-50/50 focus:bg-white"
                                value={clientData.giro}
                                onChange={e => setClientData({...clientData, giro: e.target.value})}
                            />
                        </div>
                      </div>
                  </div>
              </div>

              {/* Project Selection */}
              <div className="bg-white p-8 rounded-[2rem] shadow-lg shadow-slate-200/40 border border-slate-200/60 transition-all hover:shadow-xl hover:shadow-slate-200/50">
                  <div className="flex items-center gap-3 mb-6">
                       <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-sm">2</div>
                       <h3 className="font-bold text-lg text-slate-800">Proyecto <span className="text-slate-400 font-normal text-sm ml-1">(Opcional)</span></h3>
                  </div>
                  
                  <div className="mb-4">
                      {loadingProjects ? (
                          <Skeleton className="h-10 w-full" />
                      ) : (
                          <select 
                              className="w-full p-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm transition-all hover:border-slate-300 bg-slate-50/50 focus:bg-white cursor-pointer"
                              value={selectedProjectId}
                              onChange={e => setSelectedProjectId(e.target.value)}
                          >
                              <option value="">Seleccionar Proyecto...</option>
                              {projects.map(p => (
                                  <option key={p.id} value={p.id}>
                                      {p.code ? `[${p.code}] ` : ''}{p.name}
                                  </option>
                              ))}
                          </select>
                      )}
                  </div>

                  {selectedProject && (
                      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mt-4 animate-in fade-in zoom-in-95 duration-200">
                          <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">Cliente Original Asignado</p>
                          <p className="font-bold text-slate-700">{selectedProject.client || 'Sin Cliente'}</p>
                      </div>
                  )}
              </div>

              {/* Document Details */}
              <div className="bg-white p-8 rounded-[2rem] shadow-lg shadow-slate-200/40 border border-slate-200/60 transition-all hover:shadow-xl hover:shadow-slate-200/50">
                  <div className="flex items-center gap-3 mb-6">
                       <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-sm">3</div>
                       <h3 className="font-bold text-lg text-slate-800">Configuración</h3>
                  </div>
                  
                  <div className="space-y-4">
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo</label>
                          <select 
                              className="w-full p-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm transition-all hover:border-slate-300 bg-slate-50/50 focus:bg-white cursor-pointer"
                              value={documentType}
                              onChange={e => setDocumentType(e.target.value)}
                          >
                              <option value="electronic_invoice">Factura Electrónica</option>
                              <option value="exempt_invoice">Factura Exenta</option>
                              <option value="draft">Borrador / Pre-factura</option>
                          </select>
                      </div>

                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Fecha Emisión</label>
                          <input 
                              type="date"
                              className="w-full p-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm transition-all hover:border-slate-300 bg-slate-50/50 focus:bg-white"
                              value={invoiceDate}
                              onChange={e => setInvoiceDate(e.target.value)}
                          />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                          <div>
                              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">OC</label>
                              <input 
                                  type="text"
                                  className="w-full p-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm transition-all hover:border-slate-300 bg-slate-50/50 focus:bg-white"
                                  placeholder="Orden Compra"
                                  value={references.oc}
                                  onChange={e => setReferences({...references, oc: e.target.value})}
                              />
                          </div>
                          <div>
                              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">HES / NP</label>
                              <input 
                                  type="text"
                                  className="w-full p-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm transition-all hover:border-slate-300 bg-slate-50/50 focus:bg-white"
                                  placeholder="HES o Nota"
                                  value={references.hes}
                                  onChange={e => setReferences({...references, hes: e.target.value})}
                              />
                          </div>
                      </div>
                  </div>
              </div>

          </div>

          {/* Right Column: Items & Summary */}
          <div className="lg:col-span-2 space-y-6">
              
              {/* Expenses of the Project */}
              {selectedProjectId && (
                  <div className="bg-white rounded-[2rem] shadow-lg shadow-slate-200/40 border border-slate-200/60 overflow-hidden transition-all hover:shadow-xl hover:shadow-slate-200/50">
                      <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/80 backdrop-blur-sm">
                          <h3 className="font-bold text-lg text-slate-800">Gastos Reembolsables</h3>
                          <span className="text-xs font-bold text-indigo-700 bg-indigo-100 px-3 py-1.5 rounded-full uppercase tracking-wider border border-indigo-200/50">
                               {selectedExpenses.length} Seleccionados
                          </span>
                      </div>

                      {loadingExpenses ? (
                          <div className="p-6 space-y-4"><Skeleton className="h-12 w-full" /></div>
                      ) : expenses.length === 0 ? (
                          <div className="p-8 text-center text-slate-400 italic text-sm">No hay gastos aprobados pendientes</div>
                      ) : (
                          <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                              {expenses.map(expense => (
                                  <div 
                                      key={expense.id} 
                                      className={`p-4 flex items-center justify-between transition-all cursor-pointer group ${selectedExpenses.includes(expense.id) ? 'bg-indigo-50/50 border-l-4 border-indigo-500' : 'hover:bg-slate-50 border-l-4 border-transparent'}`}
                                      onClick={() => toggleExpense(expense.id)}
                                  >
                                      <div className="flex items-center gap-4">
                                          <div className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${selectedExpenses.includes(expense.id) ? 'bg-indigo-500 text-white' : 'border-2 border-slate-300 group-hover:border-indigo-400'}`}>
                                              {selectedExpenses.includes(expense.id) && <CheckCircle className="w-3.5 h-3.5" />}
                                          </div>
                                          <div>
                                              <p className={`font-bold text-sm transition-colors ${selectedExpenses.includes(expense.id) ? 'text-indigo-900' : 'text-slate-800 group-hover:text-indigo-700'}`}>{expense.description}</p>
                                              <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">{expense.category}</p>
                                          </div>
                                      </div>
                                      <div className={`font-bold font-mono transition-colors ${selectedExpenses.includes(expense.id) ? 'text-indigo-700' : 'text-slate-600 group-hover:text-slate-800'}`}>
                                          {formatCurrency(expense.amount)}
                                      </div>
                                  </div>
                              ))}
                          </div>
                      )}
                  </div>
              )}

              {/* Custom Service Items */}
              <div className="bg-white p-8 rounded-[2rem] shadow-lg shadow-slate-200/40 border border-slate-200/60 transition-all hover:shadow-xl hover:shadow-slate-200/50">
                  <div className="flex justify-between items-center mb-6">
                      <h3 className="font-bold text-lg text-slate-800">Conceptos de Facturación</h3>
                      <button onClick={addCustomItem} className="bg-white text-indigo-600 hover:bg-indigo-50 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 border border-indigo-200 shadow-sm transition-all active:scale-95">
                          <Plus className="w-4 h-4" /> Agregar Ítem Manual
                      </button>
                  </div>
                  
                  {customItems.length === 0 ? (
                      <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                          <p className="text-sm text-slate-500 font-medium">No hay conceptos manuales agregados.</p>
                          <p className="text-xs text-slate-400 mt-1">Usa el botón superior para añadir servicios.</p>
                      </div>
                  ) : (
                      <div className="space-y-4">
                          {customItems.map((item, idx) => (
                              <div key={idx} className="flex flex-col sm:flex-row gap-4 items-start sm:items-end bg-slate-50/80 p-5 rounded-2xl border border-slate-200/60 transition-all hover:border-indigo-200 hover:shadow-md">
                                  <div className="flex-grow w-full">
                                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Descripción del Servicio</label>
                                      <input 
                                          type="text" 
                                          className="w-full p-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm transition-all hover:border-slate-300 bg-white"
                                          value={item.description}
                                          onChange={e => updateCustomItem(idx, 'description', e.target.value)}
                                          placeholder="Ej: Honorarios por medición..."
                                      />
                                  </div>
                                  <div className="w-full sm:w-40 flex-shrink-0">
                                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Monto Neto ($)</label>
                                      <input 
                                          type="number" 
                                          className="w-full p-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-sm font-mono transition-all hover:border-slate-300 bg-white"
                                          value={item.amount}
                                          onChange={e => updateCustomItem(idx, 'amount', e.target.value)}
                                      />
                                  </div>
                                  <button onClick={() => removeCustomItem(idx)} className="text-slate-400 hover:text-rose-500 hover:bg-rose-50 p-3 rounded-xl transition-all border border-transparent hover:border-rose-200 flex-shrink-0" title="Eliminar ítem">
                                      <Trash2 className="w-5 h-5" />
                                  </button>
                              </div>
                          ))}
                      </div>
                  )}
              </div>

              {/* Global Summary & Save */}
              <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 rounded-[2rem] p-8 text-white shadow-2xl shadow-indigo-900/20 relative overflow-hidden border border-slate-700/50">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/20 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/3"></div>
                  <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500/10 rounded-full blur-[80px] translate-y-1/3 -translate-x-1/3"></div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8 relative z-10">
                      <div>
                          <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-3">Desglose de Cobro</p>
                          <div className="space-y-3">
                              {totalExpenses > 0 && (
                                  <div className="flex justify-between items-center text-sm bg-white/5 p-3 rounded-xl border border-white/10">
                                      <span className="text-slate-300 font-medium">Gastos Reembolsables</span>
                                      <span className="font-mono font-bold text-white">{formatCurrency(totalExpenses)}</span>
                                  </div>
                              )}
                              {totalCustom > 0 && (
                                  <div className="flex justify-between items-center text-sm bg-white/5 p-3 rounded-xl border border-white/10">
                                      <span className="text-slate-300 font-medium">Conceptos Facturación</span>
                                      <span className="font-mono font-bold text-white">{formatCurrency(totalCustom)}</span>
                                  </div>
                              )}
                              {totalExpenses === 0 && totalCustom === 0 && (
                                  <p className="text-sm text-slate-500 italic">No hay montos registrados.</p>
                              )}
                          </div>
                      </div>
                      <div className="md:text-right flex flex-col justify-end">
                          <p className="text-indigo-300/80 text-[10px] font-bold uppercase tracking-widest mb-2">Total a Facturar (Neto)</p>
                          <p className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-indigo-200">{formatCurrency(totalInvoice)}</p>
                      </div>
                  </div>
                  
                  <div className="mb-8 relative z-10">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Glosa Pública (Opcional)</label>
                      <textarea 
                          className="w-full bg-slate-950/50 border border-slate-700/50 rounded-xl p-4 text-sm focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 outline-none h-24 resize-none transition-all placeholder:text-slate-600 text-slate-200"
                          placeholder="Este mensaje descriptivo se incluirá en el PDF de la factura..."
                          value={glosa}
                          onChange={e => setGlosa(e.target.value)}
                      />
                  </div>

                  <button 
                      onClick={handleGenerateInvoice}
                      disabled={generating || !clientData.rut || !clientData.razonSocial || totalInvoice === 0}
                      className={`w-full py-4 rounded-2xl font-black text-lg shadow-xl shadow-indigo-900/50 transition-all flex justify-center items-center gap-2 relative z-10 ${
                          generating || !clientData.rut || !clientData.razonSocial || totalInvoice === 0
                          ? 'bg-slate-800/80 text-slate-500 cursor-not-allowed border border-slate-700/50' 
                          : 'bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white hover:scale-[1.02] active:scale-[0.98]'
                      }`}
                  >
                      {generating ? <Loader className="w-6 h-6 animate-spin" /> : <Save className="w-6 h-6" />}
                      {generating ? 'Guardando Pre-Factura...' : 'Generar y Guardar Pre-Factura'}
                  </button>
              </div>

          </div>
          </div>
        </>
      )}

      {/* ======================== */}
      {/* BATCH MODE VIEW */}
      {/* ======================== */}
      {generationMode === 'batch' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">

          {/* Batch Dropzone */}
          {batchInvoices.length === 0 && !batchProcessing && (
            <div className="relative overflow-hidden rounded-3xl">
              <div className="absolute inset-0 bg-gradient-to-br from-violet-50/50 to-indigo-50/50 -z-10" />
              <div {...getBatchRootProps()} className={`
                  border-2 border-dashed rounded-3xl p-16 text-center transition-all duration-300 cursor-pointer outline-none
                  ${isBatchDragActive ? 'border-violet-500 bg-violet-50/80 scale-[1.01] shadow-lg shadow-violet-100' : 'border-violet-200 hover:border-violet-400 hover:bg-white'}
              `}>
                  <input {...getBatchInputProps()} />
                  <div className={`
                      w-24 h-24 mx-auto mb-6 rounded-2xl flex items-center justify-center transition-all duration-300
                      ${isBatchDragActive ? 'bg-violet-600 text-white scale-110 shadow-lg shadow-violet-200' : 'bg-violet-100 text-violet-500'}
                  `}>
                      <Upload className="w-12 h-12" />
                  </div>
                  <h3 className="text-2xl font-black text-slate-800 mb-2">
                      {isBatchDragActive ? '¡Suelta los archivos aquí!' : 'Arrastra múltiples PDFs'}
                  </h3>
                  <p className="text-slate-500 text-sm max-w-md mx-auto font-medium">
                      Sube varios documentos PDF a la vez. Extraeremos RUT, Proyecto y Montos de cada uno 
                      <strong className="text-violet-600"> sin almacenar los archivos</strong> para optimizar espacio.
                  </p>
              </div>
            </div>
          )}

          {/* Processing Indicator */}
          {batchProcessing && (
            <div className="bg-white border border-violet-100 shadow-xl shadow-violet-100/50 rounded-3xl p-10 text-center">
                <div className="w-20 h-20 mx-auto bg-violet-50 rounded-2xl flex items-center justify-center mb-6 relative">
                    <div className="absolute inset-0 border-4 border-violet-100 rounded-2xl animate-pulse"></div>
                    <Loader className="w-10 h-10 text-violet-600 animate-spin" />
                </div>
                <h3 className="text-xl font-black text-slate-800 mb-2">Procesando PDFs en Lote</h3>
                <p className="text-slate-500 font-medium">Analizando {batchProgress.current} de {batchProgress.total} documentos...</p>
                <div className="mt-4 w-full max-w-xs mx-auto bg-slate-200 rounded-full h-2">
                    <div 
                      className="bg-violet-600 h-2 rounded-full transition-all duration-300" 
                      style={{ width: `${batchProgress.total > 0 ? (batchProgress.current / batchProgress.total) * 100 : 0}%` }}
                    />
                </div>
            </div>
          )}

          {/* Results Table */}
          {batchInvoices.length > 0 && !batchProcessing && (
            <>
              <div className="bg-white border border-slate-200/60 rounded-[2rem] shadow-lg shadow-slate-200/40 overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                    <div>
                        <h2 className="text-lg font-black text-slate-800">Resultados de Extracción</h2>
                        <p className="text-xs text-slate-500 mt-1">
                            {batchInvoices.filter(i => i.include).length} de {batchInvoices.length} documentos seleccionados
                        </p>
                    </div>
                    <button
                        onClick={() => setBatchInvoices([])}
                        className="text-xs font-bold text-slate-400 hover:text-rose-500 px-3 py-1.5 rounded-lg hover:bg-rose-50 transition-all"
                    >
                        <RefreshCw className="w-4 h-4 inline mr-1" /> Reiniciar
                    </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/50">
                        <th className="text-left py-3 px-4 font-bold text-slate-500 text-xs uppercase tracking-wider">Incluir</th>
                        <th className="text-left py-3 px-4 font-bold text-slate-500 text-xs uppercase tracking-wider">Archivo</th>
                        <th className="text-left py-3 px-4 font-bold text-slate-500 text-xs uppercase tracking-wider">RUT</th>
                        <th className="text-left py-3 px-4 font-bold text-slate-500 text-xs uppercase tracking-wider">Razón Social</th>
                        <th className="text-left py-3 px-4 font-bold text-slate-500 text-xs uppercase tracking-wider">Proyecto</th>
                        <th className="text-right py-3 px-4 font-bold text-slate-500 text-xs uppercase tracking-wider">Monto</th>
                        <th className="text-center py-3 px-4 font-bold text-slate-500 text-xs uppercase tracking-wider">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchInvoices.map((inv, idx) => (
                        <tr key={idx} className={`border-b border-slate-50 transition-colors ${
                          inv.status === 'error' ? 'bg-rose-50/50' : inv.include ? 'bg-indigo-50/30 hover:bg-indigo-50/50' : 'hover:bg-slate-50'
                        }`}>
                          <td className="py-3 px-4">
                            <input 
                              type="checkbox" 
                              checked={inv.include} 
                              disabled={inv.status === 'error'}
                              onChange={() => updateBatchInvoice(idx, 'include', !inv.include)}
                              className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                            />
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-700 max-w-[200px] truncate">{inv.fileName}</td>
                          <td className="py-3 px-4">
                            <input 
                              type="text" value={inv.rut} 
                              onChange={(e) => updateBatchInvoice(idx, 'rut', e.target.value)} 
                              className="w-full bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-500 outline-none py-1 text-sm"
                              placeholder="—"
                            />
                          </td>
                          <td className="py-3 px-4">
                            <input 
                              type="text" value={inv.razonSocial} 
                              onChange={(e) => updateBatchInvoice(idx, 'razonSocial', e.target.value)} 
                              className="w-full bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-500 outline-none py-1 text-sm"
                              placeholder="—"
                            />
                          </td>
                          <td className="py-3 px-4 text-slate-600">{inv.project || <span className="text-slate-400 italic">Sin proyecto</span>}</td>
                          <td className="py-3 px-4 text-right">
                            <input 
                              type="number" value={inv.amount} 
                              onChange={(e) => updateBatchInvoice(idx, 'amount', Number(e.target.value))} 
                              className="w-28 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-500 outline-none py-1 text-sm text-right font-semibold"
                            />
                          </td>
                          <td className="py-3 px-4 text-center">
                            {inv.status === 'ok' ? (
                              <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-bold"><CheckCircle className="w-4 h-4" /> OK</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-rose-500 text-xs font-bold" title={inv.error}><AlertCircle className="w-4 h-4" /> Error</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Batch Summary & Generate */}
              <div className="relative rounded-[2rem] overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950" />
                  <div className="absolute top-0 right-0 w-96 h-96 bg-violet-600/20 rounded-full blur-[80px] -z-0" />
                  <div className="relative z-10 p-8">
                      <div className="flex justify-between items-center mb-6">
                          <div>
                              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Resumen del Lote</p>
                              <p className="text-sm text-slate-500 mt-1">
                                  {batchInvoices.filter(i => i.include).length} documentos seleccionados
                              </p>
                          </div>
                          <div className="text-right">
                              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Total a Facturar</p>
                              <p className="text-4xl font-black text-white mt-1">
                                  {formatCurrency(batchInvoices.filter(i => i.include).reduce((sum, i) => sum + (Number(i.amount) || 0), 0))}
                              </p>
                          </div>
                      </div>

                      <button 
                          onClick={handleBatchGenerate}
                          disabled={batchSaving || batchInvoices.filter(i => i.include).length === 0}
                          className={`w-full py-4 rounded-2xl font-black text-lg shadow-xl transition-all flex justify-center items-center gap-2 ${
                              batchSaving || batchInvoices.filter(i => i.include).length === 0
                              ? 'bg-slate-800/80 text-slate-500 cursor-not-allowed border border-slate-700/50'
                              : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white hover:scale-[1.02] active:scale-[0.98] shadow-violet-900/50'
                          }`}
                      >
                          {batchSaving ? <Loader className="w-6 h-6 animate-spin" /> : <Save className="w-6 h-6" />}
                          {batchSaving ? 'Generando Pre-Facturas...' : `Generar ${batchInvoices.filter(i => i.include).length} Pre-Facturas`}
                      </button>
                  </div>
              </div>
            </>
          )}
        </div>
      )}

    </Layout>
  );
}
