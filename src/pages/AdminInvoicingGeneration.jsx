import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { ArrowLeft, Save, Search, CheckCircle, AlertCircle, AlertTriangle, Plus, Trash2, Upload, FileText, Loader, RefreshCw, DollarSign } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, addDoc, writeBatch, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { formatCurrency, formatProjectLabel } from '../utils/format';
import { sortProjects } from '../utils/sort';
import { Skeleton } from '../components/Skeleton';
import SearchableSelect from '../components/SearchableSelect';
import { useDropzone } from "react-dropzone";
import { getPdfText, extractInvoiceData } from '../utils/parseInvoicePDF';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function AdminInvoicingGeneration() {
  const navigate = useNavigate();
  
  // View Mode: 'individual' | 'batch'
  const [generationMode, setGenerationMode] = useState('batch'); // Default to batch as per user request

  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedProject, setSelectedProject] = useState(null);

  // Client State
  const [clients, setClients] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState('');
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
  const [observaciones, setObservaciones] = useState('');

  // Direct Net Amount Input (Task 1 — simplified billing)
  const [montoNeto, setMontoNeto] = useState('');

  // PDF Extraction State (Massive Load is now the primary function)
  const [extractionMode, setExtractionMode] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [extractionResult, ] = useState(null);

  // UI State
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingExpenses, setLoadingExpenses] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Batch Mode State
  const [batchInvoices, setBatchInvoices] = useState([]);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });

  // Fetch Projects & Clients on Load
  useEffect(() => {
    async function fetchData() {
        try {
            // Fetch Projects
            const qProj = query(collection(db, "projects"), where("status", "!=", "deleted"));
            const snapProj = await getDocs(qProj);
            setProjects(sortProjects(snapProj.docs.map(d => ({ id: d.id, ...d.data() }))));
            
            // Fetch All Clients for the dropdown
            const qClient = query(collection(db, "clients"));
            const snapClient = await getDocs(qClient);
            setClients(snapClient.docs.map(d => ({ id: d.id, ...d.data() })));
        } catch (e) {
            console.error("Error fetching data:", e);
            toast.error("Error cargando datos iniciales.");
        } finally {
            setLoadingProjects(false);
        }
    }
    fetchData();
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

  // Handle Client Selection: Fetch all expenses for ALL projects of this client
  useEffect(() => {
    if (!selectedClientId) {
        setExpenses([]);
        setSelectedExpenses([]);
        return;
    }

    const client = clients.find(c => c.id === selectedClientId);
    if (client) {
        setClientData({
            rut: client.rut || '',
            razonSocial: client.razonSocial || '',
            direccion: client.direccion || '',
            comuna: client.comuna || '',
            giro: client.giro || ''
        });
    }

    async function fetchClientExpenses() {
        setLoadingExpenses(true);
        try {
            // 1. Find all projects that point to this client (by client name or potentially a future clientId field)
            // For now, we match by selectedProject.client string if they match exactly
            // OR we can fetch expenses and filter them. 
            // Better: Fetch all approved expenses without invoiceId.
            const q = query(
                collection(db, "expenses"), 
                where("status", "==", "approved")
            );
            
            const snapshot = await getDocs(q);
            const allApproved = snapshot.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(e => !e.invoiceId);

            // 2. Filter expenses that belong to projects of this client
            // We need to know which projects belong to this client.
            const clientProjects = projects.filter(p => p.client === client?.razonSocial);
            const clientProjectIds = clientProjects.map(p => p.id);

            const filtered = allApproved.filter(e => clientProjectIds.includes(e.projectId));

            setExpenses(filtered);
            setSelectedExpenses(filtered.map(e => e.id));
        } catch (e) {
            console.error("Error fetching client expenses:", e);
            toast.error("Error cargando gastos del cliente.");
        } finally {
            setLoadingExpenses(false);
        }
    }

    fetchClientExpenses();
  }, [selectedClientId, clients, projects]);

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

  // PDF Extraction Logic — uses centralized getPdfText & extractInvoiceData from parseInvoicePDF.js

  const onDrop = useCallback(async (acceptedFiles) => {
    if (acceptedFiles.length === 0) return;
    const file = acceptedFiles[0];
    setExtracting(true);

    try {
      const text = await getPdfText(file);
      if (!text) {
        toast.warning('El PDF es una imagen escaneada. Ingresa los datos manualmente.');
        setExtractionMode(false);
        return;
      }

      const { rut, amount, date, projectId: extractedProjectId, clientName: extractedClientName } = extractInvoiceData(text, projects);

      // Auto-select project
      if (extractedProjectId) {
        const matched = projects.find(p => p.id === extractedProjectId);
        if (matched) {
          setSelectedProjectId(matched.id);
          toast.success(`Proyecto detectado: ${matched.name}`);
        }
      }

      // Auto-fill amount
      if (amount > 0) {
        setMontoNeto(String(amount));
        setCustomItems([{ description: 'Servicios según PDF', amount }]);
        toast.success(`Monto detectado: ${formatCurrency(amount)}`);
      } else {
        toast.warning('No se pudo detectar el monto neto. Ingresa el valor manualmente.');
      }

      // Auto-fill RUT and look up client
      if (rut) {
        setClientData(prev => ({ 
          ...prev, 
          rut, 
          razonSocial: extractedClientName || prev.razonSocial 
        }));
        
        // Only trigger lookup if client name wasn't found in PDF or to enrichment
        if (!extractedClientName) {
        const cleanRut = rut.replace(/[.-]/g, '').toUpperCase();
            try {
              const q = query(collection(db, 'clients'), where('rut', '==', cleanRut));
              const snapshot = await getDocs(q);
              if (!snapshot.empty) {
                const data = snapshot.docs[0].data();
                setClientData({ 
                  rut, 
                  razonSocial: data.razonSocial || '', 
                  direccion: data.direccion || '', 
                  comuna: data.comuna || '', 
                  giro: data.giro || '' 
                });
                toast.success('Cliente encontrado en base de datos.');
              }
            } catch { /* lookup failed, ignore */ }
        }
      }

      // Auto-fill date
      if (date) {
        setInvoiceDate(date);
      }

      setExtractionMode(false);
    } catch (e) {
      console.error('Extraction error:', e);
      toast.error('Error al extraer datos del PDF.');
      setExtractionMode(false);
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
  const montoNetoNum = Number(montoNeto) || 0;
  // If the user entered a direct Monto Neto, that takes precedence
  const totalInvoice = montoNetoNum > 0 ? montoNetoNum : (totalExpenses + totalCustom);

  // Save / Generate
  const handleGenerateInvoice = async () => {
      if (!clientData.rut || !clientData.razonSocial) {
          toast.error("RUT y Razón Social son requeridos");
          return;
      }
      if (totalInvoice <= 0) {
          toast.error("Debe ingresar un Monto Neto a Facturar mayor a 0.");
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

          // 2. Determine Project Name (handle multi-project)
          const selectedExpDocs = expenses.filter(e => selectedExpenses.includes(e.id));
          const projectNames = [...new Set(selectedExpDocs.map(e => projects.find(p => p.id === e.projectId)?.name).filter(Boolean))];
          
          let displayProjectName = selectedProject?.name || 'Manual';
          if (projectNames.length > 1) {
              displayProjectName = `Múltiples (${projectNames.length})`;
          } else if (projectNames.length === 1) {
              displayProjectName = projectNames[0];
          }

          // 3. Create Invoice Document
          const invoiceData = {
              clientId: cleanRut,
              clientName: clientData.razonSocial,
              clientRut: clientData.rut,
              clientAddress: clientData.direccion,
              clientComuna: clientData.comuna, // Added
              
              projectId: selectedProjectId || (projectNames.length === 1 ? selectedExpDocs[0].projectId : 'multi'),
              projectName: displayProjectName,
              projectCode: selectedProject?.code || '',
              projectRecurrence: selectedProject?.recurrence || '',
              
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
              observaciones: observaciones,
              
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

          toast.success("Registro de factura generado exitosamente");
          navigate('/admin/invoicing');
          
      } catch (e) {
          console.error("Error generating invoice:", e);
          toast.error("Ocurrió un error al generar el registro de factura.");
      } finally {
          setGenerating(false);
      }
  };

  // PDF Export Logic
  const generatePDF = (invData, exps, customs) => {
      const doc = new jsPDF();
      
      // Header
      doc.setFontSize(22);
      doc.setTextColor(30, 41, 59); // slate-800
      doc.text("REGISTRO DE FACTURA", 14, 22);
      
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139); // slate-500
      doc.text(`Fecha de Emisión: ${invData.issueDate}`, 14, 30);
      doc.text(`ID Registro: ${invData.id || 'Nuevo'}`, 14, 35);

      // Client Info
      doc.setFontSize(12);
      doc.setTextColor(30, 41, 59);
      doc.text("DATOS DEL CLIENTE", 14, 50);
      doc.setLineWidth(0.5);
      doc.line(14, 52, 70, 52);

      doc.setFontSize(10);
      doc.text(`Razón Social: ${invData.clientName}`, 14, 60);
      doc.text(`RUT: ${invData.clientRut}`, 14, 65);
      doc.text(`Dirección: ${invData.clientAddress || 'N/A'}`, 14, 70);
      doc.text(`Comuna: ${invData.clientComuna || 'N/A'}`, 14, 75);

      // Projects Involved
      const uniqueProjects = [...new Set(exps.map(e => e.projectName || 'Sin Proyecto'))];
      doc.setFontSize(12);
      doc.text("PROYECTOS ASOCIADOS", 120, 50);
      doc.line(120, 52, 180, 52);
      doc.setFontSize(9);
      uniqueProjects.forEach((p, i) => {
          doc.text(`• ${p}`, 120, 60 + (i * 5));
      });

      // Table of Items
      const tableData = [
          ...exps.map(e => [
              e.date?.seconds ? new Date(e.date.seconds * 1000).toLocaleDateString() : (e.date || 'S/F'),
              `[${e.projectName || 'S/P'}] ${e.description}`,
              formatCurrency(e.amount)
          ]),
          ...customs.map(c => [
              '-',
              c.description,
              formatCurrency(c.amount)
          ])
      ];

      autoTable(doc, {
          startY: 90,
          head: [['Fecha', 'Descripción / Proyecto', 'Monto Neto']],
          body: tableData,
          headStyles: { fillStyle: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
          alternateRowStyles: { fillStyle: [248, 250, 252] },
          margin: { top: 90 },
      });

      // Totals
      const finalY = (doc).lastAutoTable.finalY + 10;
      doc.setFontSize(10);
      doc.text(`Monto Neto:`, 140, finalY);
      doc.text(`${formatCurrency(invData.totalAmount)}`, 180, finalY, { align: 'right' });
      
      doc.text(`IVA (19%):`, 140, finalY + 7);
      doc.text(`${formatCurrency(Math.round(invData.totalAmount * 0.19))}`, 180, finalY + 7, { align: 'right' });
      
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text(`TOTAL:`, 140, finalY + 16);
      doc.text(`${formatCurrency(Math.round(invData.totalAmount * 1.19))}`, 180, finalY + 16, { align: 'right' });

      // Glosa
      if (invData.glosa) {
          doc.setFontSize(9);
          doc.setFont("helvetica", "normal");
          doc.setTextColor(100);
          doc.text("Notas/Glosa:", 14, finalY + 30);
          doc.text(invData.glosa, 14, finalY + 35, { maxWidth: 180 });
      }

      doc.save(`Registro_Factura_${invData.clientName.replace(/\s+/g, '_')}.pdf`);
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
        
        const { rut: extractedRut, amount: extractedAmount, projectId: extractedProjectId, clientName: extractedClientName } = extractInvoiceData(text, projects);

        let clientName = extractedClientName || '';
        if (!clientName && extractedRut) {
          const cleanRut = extractedRut.replace(/[.-]/g, '').toUpperCase();
          try {
            const q = query(collection(db, 'clients'), where('rut', '==', cleanRut));
            const snapshot = await getDocs(q);
            if (!snapshot.empty) clientName = snapshot.docs[0].data().razonSocial || '';
          } catch { /* ignore */ }
        }

        let matchedProject = null;
        if (extractedProjectId) {
          matchedProject = projects.find(p => p.id === extractedProjectId) || null;
        }

        const entry = {
          fileName:    file.name,
          status:      extractedAmount > 0 ? 'ok' : 'error',
          error:       extractedAmount > 0 ? null : 'Monto no detectado — ingresa manualmente',
          rut:         extractedRut || '',
          razonSocial: clientName,
          project:     matchedProject?.name || '',
          projectId:   matchedProject?.id   || '',
          amount:      extractedAmount,
          observaciones: '',
          include:     extractedAmount > 0,
        };

        // Firestore duplicate check
        if (extractedRut && extractedAmount > 0) {
          try {
            const cleanRut = extractedRut.replace(/[.-]/g, '').toUpperCase();
            const dupQ = query(
              collection(db, 'invoices'),
              where('clientRut', '==', cleanRut),
              where('totalAmount', '==', extractedAmount)
            );
            const dupSnap = await getDocs(dupQ);
            const existingNonVoid = dupSnap.docs.find(d => d.data().status !== 'void');
            if (existingNonVoid) {
              entry.status = 'warning';
              entry.error  = 'Posible duplicado: ya existe una factura con este RUT y monto en el sistema';
            }
          } catch { /* ignore — non-critical check */ }
        }

        results.push(entry);
      } catch (e) {
        results.push({ fileName: file.name, status: 'error', error: e.message, rut: '', razonSocial: '', project: '', amount: 0, include: false });
      }
    }

    // Local duplicate check: group by rut + amount within this batch
    const groups = {};
    results.forEach((r, i) => {
      if (!r.rut || !r.amount) return;
      const key = `${r.rut}_${r.amount}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(i);
    });
    Object.values(groups).forEach(indices => {
      if (indices.length > 1) {
        indices.forEach(i => {
          if (results[i].status !== 'error') {
            results[i].status = 'warning';
            results[i].error  = 'Posible duplicado en este lote (mismo RUT y monto)';
          }
        });
      }
    });

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

        const matchedProject = projects.find(p => p.id === inv.projectId);
        const invoiceData = {
          clientId: inv.rut ? inv.rut.replace(/[.-]/g, '').toUpperCase() : 'desconocido',
          clientName: inv.razonSocial || 'Sin Razón Social',
          clientRut: inv.rut || '',
          projectId: inv.projectId || 'manual',
          projectName: inv.project || 'Varios / Sin Proyecto',
          projectCode: matchedProject?.code || '',
          projectRecurrence: matchedProject?.recurrence || '',
          glosa: `Generado desde: ${inv.fileName}`,
          observaciones: inv.observaciones || '',
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

      toast.success(`${successCount} registros de factura generados exitosamente.`);
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
    <Layout title="Generar Registro de Factura">
      <div className="max-w-6xl mx-auto">
          {/* Main Action Banner */}
          <div className="bg-gradient-to-r from-slate-900 to-indigo-950 rounded-[2.5rem] p-8 md:p-12 mb-10 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-[100px] -z-0" />
              <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-blue-500/10 rounded-full blur-[80px] -z-0" />
              
              <div className="relative z-10 flex flex-col md:flex-row justify-between items-start gap-8">
                  <div className="text-center md:text-left">
                      <h1 className="text-4xl md:text-5xl font-black text-white mb-4 tracking-tight">
                          Registro de <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-blue-300">Facturas</span>
                      </h1>
                      <p className="text-slate-400 text-lg font-medium max-w-xl">
                          {generationMode === 'batch'
                            ? 'Carga masiva de documentos PDF para registrar facturas rápidamente.'
                            : 'Registro individual de factura con datos manuales o extracción PDF.'}
                      </p>
                  </div>
                  
                  <button 
                      onClick={() => setGenerationMode(generationMode === 'batch' ? 'individual' : 'batch')}
                      className="text-slate-500 hover:text-indigo-300 text-xs font-medium transition-all mt-2 flex items-center gap-1.5 shrink-0"
                  >
                      {generationMode === 'batch' ? (
                        <><Plus className="w-3.5 h-3.5" /> Cambiar a Registro Manual</>
                      ) : (
                        <><Upload className="w-3.5 h-3.5" /> Cambiar a Carga Masiva</>
                      )}
                  </button>
              </div>
          </div>

          {generationMode === 'individual' ? (
            <>
              {extractionMode && !extractionResult && (
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
                      <h3 className="font-bold text-lg text-slate-800">Seleccionar Cliente</h3>
                  </div>
                  
                  <div className="space-y-4">
                      <div className="mb-4">
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Cliente Registrado</label>
                          {loadingProjects ? (
                              <Skeleton className="h-10 w-full" />
                          ) : (
                              <SearchableSelect
                                  options={clients.map(c => ({
                                      value: c.id,
                                      label: `${c.razonSocial} (${c.rut})`
                                  }))}
                                  value={selectedClientId}
                                  onChange={setSelectedClientId}
                                  placeholder="Buscar cliente..."
                              />
                          )}
                      </div>

                      <div className="relative pt-4 border-t border-slate-100">
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">RUT (Manual o Autocompletado)</label>
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
                       <h3 className="font-bold text-lg text-slate-800">Proyecto Principal <span className="text-slate-400 font-normal text-sm ml-1">(Opcional)</span></h3>
                  </div>
                  
                  <div className="mb-4">
                      {loadingProjects ? (
                          <Skeleton className="h-10 w-full" />
                      ) : (
                          <SearchableSelect
                              options={projects
                                .filter(p => !selectedClientId || p.client === clientData.razonSocial)
                                .map(p => ({
                                  value: p.id,
                                  label: formatProjectLabel(p)
                              }))}
                              value={selectedProjectId}
                              onChange={setSelectedProjectId}
                              placeholder="Buscar proyecto..."
                          />
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
                              <option value="draft">Borrador / Registro de Factura</option>
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

              {/* MONTO NETO A FACTURAR — Primary Input */}
              <div className="bg-gradient-to-r from-indigo-50 to-blue-50 p-6 rounded-[2rem] border-2 border-indigo-200 shadow-md shadow-indigo-100/50 transition-all hover:shadow-lg">
                  <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md">
                          <DollarSign className="w-5 h-5" />
                      </div>
                      <div>
                          <h3 className="font-black text-lg text-indigo-900">Monto Neto a Facturar</h3>
                          <p className="text-xs text-indigo-500 font-medium">Ingrese el valor neto total del cobro (sin IVA)</p>
                      </div>
                  </div>
                  <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-indigo-400 font-bold text-lg">$</span>
                      <input
                          type="number"
                          className="w-full pl-10 pr-4 py-4 bg-white border-2 border-indigo-200 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none text-2xl font-black font-mono text-indigo-900 transition-all hover:border-indigo-300 placeholder:text-indigo-200"
                          placeholder="0"
                          value={montoNeto}
                          onChange={e => setMontoNeto(e.target.value)}
                          min="0"
                      />
                  </div>
                  {montoNetoNum > 0 && (
                      <div className="mt-3 grid grid-cols-2 gap-3">
                          <div className="bg-white/80 p-3 rounded-xl border border-indigo-100">
                              <p className="text-[10px] text-indigo-400 uppercase font-bold">IVA (19%)</p>
                              <p className="font-mono text-sm font-bold text-indigo-700">{formatCurrency(Math.round(montoNetoNum * 0.19))}</p>
                          </div>
                          <div className="bg-indigo-600 p-3 rounded-xl text-white shadow-md">
                              <p className="text-[10px] text-indigo-200 uppercase font-bold">Total con IVA</p>
                              <p className="font-mono text-sm font-bold">{formatCurrency(Math.round(montoNetoNum * 1.19))}</p>
                          </div>
                      </div>
                  )}
              </div>
              
              {/* Expenses of the Client (Grouped by Project) */}
              {(selectedClientId || selectedProjectId) && (
                  <div className="bg-white rounded-[2rem] shadow-lg shadow-slate-200/40 border border-slate-200/60 overflow-hidden transition-all hover:shadow-xl hover:shadow-slate-200/50">
                      <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/80 backdrop-blur-sm">
                          <h3 className="font-bold text-lg text-slate-800">Gastos Reembolsables por Proyecto</h3>
                          <span className="text-xs font-bold text-indigo-700 bg-indigo-100 px-3 py-1.5 rounded-full uppercase tracking-wider border border-indigo-200/50">
                               {selectedExpenses.length} Seleccionados
                          </span>
                      </div>

                      {loadingExpenses ? (
                          <div className="p-6 space-y-4"><Skeleton className="h-12 w-full" /></div>
                      ) : expenses.length === 0 ? (
                          <div className="p-8 text-center text-slate-400 italic text-sm">No hay gastos aprobados pendientes</div>
                      ) : (
                          <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
                              {/* Grouping Logic */}
                              {Object.entries(
                                  expenses.reduce((acc, exp) => {
                                      const pName = projects.find(p => p.id === exp.projectId)?.name || 'Otros / Sin Proyecto';
                                      if (!acc[pName]) acc[pName] = [];
                                      acc[pName].push(exp);
                                      return acc;
                                  }, {})
                              ).map(([projectName, projectExpenses]) => {
                                  const projectSubtotal = projectExpenses
                                    .filter(e => selectedExpenses.includes(e.id))
                                    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

                                  return (
                                      <div key={projectName} className="bg-white">
                                          <div className="bg-slate-50/50 px-6 py-2 flex justify-between items-center border-y border-slate-100">
                                              <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{projectName}</span>
                                              <span className="text-xs font-bold text-slate-600">Subtotal: {formatCurrency(projectSubtotal)}</span>
                                          </div>
                                          {projectExpenses.map(expense => (
                                              <div 
                                                  key={expense.id} 
                                                  className={`p-4 px-6 flex items-center justify-between transition-all cursor-pointer group ${selectedExpenses.includes(expense.id) ? 'bg-indigo-50/30' : 'hover:bg-slate-50'}`}
                                                  onClick={() => toggleExpense(expense.id)}
                                              >
                                                  <div className="flex items-center gap-4">
                                                      <div className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${selectedExpenses.includes(expense.id) ? 'bg-indigo-500 text-white' : 'border-2 border-slate-300 group-hover:border-indigo-400'}`}>
                                                          {selectedExpenses.includes(expense.id) && <CheckCircle className="w-3.5 h-3.5" />}
                                                      </div>
                                                      <div>
                                                          <p className={`font-bold text-sm transition-colors ${selectedExpenses.includes(expense.id) ? 'text-indigo-900' : 'text-slate-800 group-hover:text-indigo-700'}`}>{expense.description}</p>
                                                          <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">{expense.category} • {expense.date?.seconds ? new Date(expense.date.seconds * 1000).toLocaleDateString() : (expense.date || 'S/F')}</p>
                                                      </div>
                                                  </div>
                                                  <div className={`font-bold font-mono transition-colors ${selectedExpenses.includes(expense.id) ? 'text-indigo-700' : 'text-slate-600 group-hover:text-slate-800'}`}>
                                                      {formatCurrency(expense.amount)}
                                                  </div>
                                              </div>
                                          ))}
                                      </div>
                                  );
                              })}
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
                  
                  <div className="mb-6 relative z-10">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Glosa Pública (Opcional)</label>
                      <textarea 
                          className="w-full bg-slate-950/50 border border-slate-700/50 rounded-xl p-4 text-sm focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 outline-none h-24 resize-none transition-all placeholder:text-slate-600 text-slate-200"
                          placeholder="Este mensaje descriptivo se incluirá en el PDF de la factura..."
                          value={glosa}
                          onChange={e => setGlosa(e.target.value)}
                      />
                  </div>

                  <div className="mb-8 relative z-10">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Observaciones Internas (Opcional)</label>
                      <textarea 
                          className="w-full bg-slate-950/50 border border-slate-700/50 rounded-xl p-4 text-sm focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 outline-none h-20 resize-none transition-all placeholder:text-slate-600 text-slate-200"
                          placeholder="Notas internas sobre esta factura (no se incluyen en el PDF)..."
                          value={observaciones}
                          onChange={e => setObservaciones(e.target.value)}
                      />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative z-10">
                    <button 
                        onClick={handleGenerateInvoice}
                        disabled={generating || !clientData.rut || !clientData.razonSocial || totalInvoice <= 0}
                        className={`w-full py-4 rounded-2xl font-black text-lg shadow-xl transition-all flex justify-center items-center gap-2 ${
                            generating || !clientData.rut || !clientData.razonSocial || totalInvoice <= 0
                            ? 'bg-slate-800/80 text-slate-500 cursor-not-allowed border border-slate-700/50' 
                            : 'bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white hover:scale-[1.02] active:scale-[0.98]'
                        }`}
                    >
                        {generating ? <Loader className="w-6 h-6 animate-spin" /> : <Save className="w-6 h-6" />}
                        {generating ? 'Guardando...' : 'Generar y Guardar'}
                    </button>

                    <button 
                        onClick={() => generatePDF({
                            ...clientData,
                            issueDate: invoiceDate,
                            totalAmount: totalInvoice,
                            glosa: glosa
                        }, expenses.filter(e => selectedExpenses.includes(e.id)).map(e => ({
                            ...e,
                            projectName: projects.find(p => p.id === e.projectId)?.name
                        })), customItems)}
                        disabled={totalInvoice <= 0}
                        className={`w-full py-4 rounded-2xl font-black text-lg shadow-xl transition-all flex justify-center items-center gap-2 bg-white border-2 border-indigo-600 text-indigo-700 hover:bg-indigo-50 active:scale-[0.98] ${
                            totalInvoice <= 0 ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                    >
                        <FileText className="w-6 h-6" /> Exportar PDF
                    </button>
                  </div>
              </div>

          </div>
        </div>
      </>
    ) : (
      /* ======================== */
      /* BATCH MODE VIEW */
      /* ======================== */
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
                          <th className="text-left py-3 px-4 font-bold text-slate-500 text-xs uppercase tracking-wider">Observaciones</th>
                          <th className="text-center py-3 px-4 font-bold text-slate-500 text-xs uppercase tracking-wider">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batchInvoices.map((inv, idx) => (
                          <tr key={idx} className={`border-b border-slate-50 transition-colors ${
                            inv.status === 'error' ? 'bg-rose-50/50' : inv.status === 'warning' ? 'bg-amber-50/50' : inv.include ? 'bg-indigo-50/30 hover:bg-indigo-50/50' : 'hover:bg-slate-50'
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
                            <td className="py-3 px-4">
                              <input 
                                type="text" value={inv.observaciones || ''} 
                                onChange={(e) => updateBatchInvoice(idx, 'observaciones', e.target.value)} 
                                className="w-full bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-500 outline-none py-1 text-sm"
                                placeholder="—"
                              />
                            </td>
                            <td className="py-3 px-4 text-center">
                              {inv.status === 'ok' ? (
                                <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-bold"><CheckCircle className="w-4 h-4" /> OK</span>
                              ) : inv.status === 'warning' ? (
                                <span className="inline-flex flex-col items-center gap-1 text-amber-600 text-[10px] font-bold text-center leading-tight">
                                  <span className="flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Advertencia</span>
                                  {inv.error && <span className="font-normal opacity-80 max-w-[120px]">{inv.error}</span>}
                                </span>
                              ) : (
                                <span className="inline-flex flex-col items-center gap-1 text-rose-500 text-[10px] font-bold text-center leading-tight">
                                  <span className="flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Error</span>
                                  {inv.error && <span className="font-normal opacity-80 max-w-[120px]">{inv.error}</span>}
                                </span>
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
                            {batchSaving ? 'Generando Registros...' : `Generar ${batchInvoices.filter(i => i.include).length} Registros`}
                        </button>
                    </div>
                </div>
              </>
            )}
        </div>
      )}
      </div>
    </Layout>
  );
}
