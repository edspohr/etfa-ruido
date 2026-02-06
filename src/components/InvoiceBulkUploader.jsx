import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import * as pdfjs from "pdfjs-dist";
import {
  Upload,
  FileText,
  CheckCircle,
  AlertTriangle,
  X,
  Loader,
  RefreshCw,
} from "lucide-react";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { toast } from "sonner";

// Configure PDF.js Worker via CDN to avoid Vite bundling issues
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

export default function InvoiceBulkUploader({ onProcessingComplete, onClose }) {
  const [files, setFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState(null); // { success: [], errors: [] }

  const onDrop = useCallback((acceptedFiles) => {
    setFiles(acceptedFiles);
    setResults(null);
  }, []);

  const removeFile = (index) => {
    const newFiles = [...files];
    newFiles.splice(index, 1);
    setFiles(newFiles);
  };

  const getPdfText = async (file) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      let fullText = "";

      // Limit pages to scan (e.g. first 3 pages) to save time, usually info is on page 1
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

  /**
   * Core Logic: Find a project that matches the text in the PDF
   */
  const findMatchingProject = async (text, activeProjects) => {
    // We iterate through ALL active projects and check if their "Code + Recurrence" signature exists in the text.
    // This is safer than trying to extract a code from the text and looking it up.

    // Normalize text for search (remove extra spaces, lower case)
    const normalizedText = text.toLowerCase().replace(/\s+/g, " ");

    for (const project of activeProjects) {
      if (!project.code) continue;

      const code = project.code.toLowerCase().trim();
      const recurrence = project.recurrence
        ? project.recurrence.toLowerCase().trim()
        : "";

      // 1. Exact Code Match is a MUST
      // If the regex is too loose, we might match wrong things.
      // We look for the Project Code first.
      if (!normalizedText.includes(code)) continue;

      // 2. If Recurrence exists, we MUST find it too, in proximity or combination
      if (recurrence) {
        // Patterns to check:
        // "CODE-RECURRENCE" -> "prj001-a"
        // "CODE RECURRENCE" -> "prj001 a"
        // "CODE Recurrencia RECURRENCE" -> "prj001 recurrencia a"

        // Simple check: Does the text contain the Recurrence string?
        // Danger: Recurrence "A" is too common. finding "A" in text is guaranteed.

        // Robust check:
        // Look for specific patterns.
        // We construct a dynamic regex for this specific project.

        // Escape special chars in code just in case
        const safeCode = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const safeRec = recurrence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        // Regex: Code followed by separator followed by Recurrence
        // Separators: " - ", "-", " "
        const pattern = new RegExp(`${safeCode}[\\s-]*${safeRec}\\b`, "i");

        if (pattern.test(normalizedText)) {
          return project;
        }

        // Also check for "Recurrencia X" near the code?
        // Maybe just checking if both strings exists close to each other?
        // For now, let's stick to the flexible pattern above.
      } else {
        // If project has no recurrence, and we found the code, is it a match?
        // Yes, assume unique project codes for non-recurring projects.
        return project;
      }
    }

    return null;
  };

  const processFiles = async () => {
    if (files.length === 0) return;
    setProcessing(true);

    const successLog = [];
    const errorLog = [];

    try {
      // 1. Fetch all active projects to cache them for matching
      const q = query(
        collection(db, "projects"),
        where("status", "!=", "deleted"),
      );
      const snapshot = await getDocs(q);
      const activeProjects = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      // 2. Iterate files
      for (const file of files) {
        try {
          // A. Extract Text
          const text = await getPdfText(file);
          if (!text) {
            errorLog.push({
              file: file.name,
              error: "No se pudo leer el texto del PDF",
            });
            continue;
          }

          // B. Find Match
          const matchedProject = await findMatchingProject(
            text,
            activeProjects,
          );

          if (!matchedProject) {
            errorLog.push({
              file: file.name,
              error:
                "No se encontró código de proyecto válido (o recurrencia no coincide)",
            });
            continue;
          }

          // C. Extra Data Extraction (Amount, Date) - Basic heuristics
          // Attempt to find "Total" followed by number
          // Heuristic: Look for largest number in the text? searching for "Total"?
          // Let's keep it simple: Just create the invoice linked to project, let admin fill details later if extraction fails.
          // We will default amount to 0 or try to parse.

          // Let's try to extract Total Amount
          // Regex: "Total" .... "$ 1.000.000" or "1.000.000"
          // This is hard to get right generically. Let's start with 0 and rely on user to verify or reconciliation to match.
          // BUT, user asked for "Monto Total" extraction.

          let extractedAmount = 0;
          // Try to find "Total" keyword and grab subsequent number
          const totalMatch = text.match(/total[\s\S]{0,20}?\$?([\d.,]+)/i);
          if (totalMatch && totalMatch[1]) {
            // unexpected formats like 1.000,00 or 1,000.00
            let s = totalMatch[1]
              .replace(/\./g, "")
              .replace(",", ".")
              .replace(/[^\d.]/g, "");
            extractedAmount = parseFloat(s) || 0;
          }

          // D. Create Invoice Record
          const invoiceData = {
            clientId: matchedProject.client || "Desconocido",
            clientName: matchedProject.client || "Desconocido",
            projectId: matchedProject.id,
            projectName: matchedProject.name,
            projectRecurrence: matchedProject.recurrence || "N/A",

            status: "issued", // Factura emitida
            paymentStatus: "pending",

            documentType: "electronic_invoice",
            source: "bulk_upload",
            metadata: {
              originalFileName: file.name,
              extractedTextPreview: text.substring(0, 100),
            },

            createdAt: serverTimestamp(),
            totalAmount: extractedAmount,
            // We assume it covers expenses? Or just billing?
            // We don't link expenses automatically here unless complex logic.
            // For now, this is "Facturación" flow (Billing).
            totalExpenses: 0,
            totalCustomItems: extractedAmount,
          };

          await addDoc(collection(db, "invoices"), invoiceData);

          // E. Update Project Status -> 'invoiced'
          const projRef = doc(db, "projects", matchedProject.id);
          await updateDoc(projRef, {
            billingStatus: "invoiced",
            lastBillingDate: serverTimestamp(),
          });

          successLog.push({
            file: file.name,
            project: matchedProject.name,
            code: `${matchedProject.code || ""} ${matchedProject.recurrence || ""}`,
          });
        } catch (innerErr) {
          console.error("Error processing file:", file.name, innerErr);
          errorLog.push({
            file: file.name,
            error: "Error interno al procesar",
          });
        }
      }
    } catch (err) {
      console.error("Global processing error:", err);
      toast.error("Error general en el proceso");
    } finally {
      setProcessing(false);
      setResults({ success: successLog, errors: errorLog });
      setFiles([]); // Clear queue? Or keep failed?
      // Actually, let's keep the queue empty so they can retry only failed ones if they drag them again
      if (onProcessingComplete) onProcessingComplete();
    }
  };

  const { getRootProps, getInputProps } = useDropzone({ 
    onDrop, 
    accept: {'application/pdf': ['.pdf']},
    disabled: !!results 
  });

  return (
    <div className="bg-white rounded-xl shadow-lg border border-slate-100 p-6 max-w-2xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <Upload className="w-6 h-6 text-indigo-600" /> Carga Masiva de
          Facturas
        </h2>
        {onClose && (
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {!results && (
        <>
          <div
            className="border-2 border-dashed border-slate-300 rounded-xl p-10 text-center hover:bg-slate-50 transition cursor-pointer"
            {...getRootProps()}
          >
            <input {...getInputProps()} />
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-600 font-medium text-lg">
              Arrastra tus facturas PDF aquí
            </p>
            <p className="text-slate-400 text-sm mt-2">
              o haz clic para seleccionar archivos
            </p>
          </div>

          {files.length > 0 && (
            <div className="mt-6 space-y-3">
              <p className="font-bold text-slate-700 text-sm mb-2">
                {files.length} Archivos seleccionados:
              </p>
              <div className="max-h-40 overflow-y-auto space-y-2 pr-2">
                {files.map((f, i) => (
                  <div
                    key={i}
                    className="flex justify-between items-center bg-slate-50 p-2 rounded border border-slate-100 text-sm"
                  >
                    <span className="truncate max-w-[80%] text-slate-600">
                      {f.name}
                    </span>
                    <button
                      onClick={() => removeFile(i)}
                      className="text-red-400 hover:text-red-600 p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={processFiles}
                disabled={processing}
                className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 transition flex justify-center items-center mt-4"
              >
                {processing ? (
                  <Loader className="w-5 h-5 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="w-5 h-5 mr-2" />
                )}
                {processing ? "Procesando Documentos..." : "Procesar Facturas"}
              </button>
            </div>
          )}
        </>
      )}

      {results && (
        <div className="space-y-6">
          {results.success.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <h3 className="font-bold text-green-800 mb-2 flex items-center gap-2">
                <CheckCircle className="w-5 h-5" /> {results.success.length}{" "}
                Procesados Correctamente
              </h3>
              <ul className="text-sm space-y-1 text-green-700/80">
                {results.success.map((res, i) => (
                  <li key={i}>
                    • {res.file} →{" "}
                    <strong>
                      {res.project} ({res.code})
                    </strong>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {results.errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <h3 className="font-bold text-red-800 mb-2 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" /> {results.errors.length}{" "}
                Errores
              </h3>
              <ul className="text-sm space-y-2 text-red-700/80">
                {results.errors.map((err, i) => (
                  <li key={i} className="flex flex-col">
                    <span className="font-semibold text-red-800">
                      • {err.file}
                    </span>
                    <span className="ml-2 text-xs opacity-90">{err.error}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={() => {
              setFiles([]);
              setResults(null);
            }}
            className="w-full border border-slate-300 text-slate-600 py-2 rounded-lg font-bold hover:bg-slate-50 transition"
          >
            Volver / Cargar más
          </button>
        </div>
      )}
    </div>
  );
}
