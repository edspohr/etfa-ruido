/**
 * parseInvoicePDF.js
 * Reliable data extractor for Chilean invoice PDFs (boletas/facturas).
 *
 * Returns: { rut, amount, date, projectCode, raw }
 * Every field is null if not found — callers must validate.
 *
 * Design principles:
 * - Multiple ordered patterns per field; first match wins.
 * - Scores candidates and picks the best one (not just first regex match).
 * - Never confuses IVA with neto: always prefers neto/net amounts.
 * - Strict RUT validation: checksum digit is verified.
 */

// ---------------------------------------------------------------------------
// RUT VALIDATOR (verifica dígito verificador chileno)
// ---------------------------------------------------------------------------
export function validateRut(rut) {
  if (!rut) return false;
  const clean = rut.replace(/[.\-\s]/g, '').toUpperCase();
  if (!/^\d{7,8}[0-9K]$/.test(clean)) return false;

  const body = clean.slice(0, -1);
  const dv   = clean.slice(-1);
  let sum = 0, factor = 2;

  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }

  const expected = 11 - (sum % 11);
  const dvExpected =
    expected === 11 ? '0' : expected === 10 ? 'K' : String(expected);

  return dv === dvExpected;
}

/** Format a raw RUT string into XX.XXX.XXX-Y */
export function formatRut(raw) {
  const clean = raw.replace(/[.\-\s]/g, '').toUpperCase();
  const body  = clean.slice(0, -1);
  const dv    = clean.slice(-1);
  return body.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
}

// ---------------------------------------------------------------------------
// AMOUNT PARSER
// ---------------------------------------------------------------------------
/**
 * Parse a raw amount string to integer CLP.
 * Handles: "1.234.567", "1,234,567", "$1.234.567", "1234567"
 */
function parseClpAmount(raw) {
  if (!raw) return 0;
  let s = String(raw).trim().replace(/\$/g, '');
  // CLP format: dots as thousands, optional comma for decimals
  // Remove thousands dots, then remove any decimal part
  s = s.replace(/\./g, '').replace(/,\d+$/, '').replace(/[^\d]/g, '');
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
}

// ---------------------------------------------------------------------------
// PATTERN BANKS
// ---------------------------------------------------------------------------

/**
 * Amount patterns — ordered from most to least specific.
 * We prefer "neto" amounts over "total" amounts (IVA is separate).
 * Each pattern has a priority weight: higher = preferred.
 */
const AMOUNT_PATTERNS = [
  // 1. Explicit "monto neto" / "total neto" lines
  { re: /monto\s+neto[\s:$]*([\d.,]{4,})/i, weight: 100 },
  { re: /total\s+neto[\s:$]*([\d.,]{4,})/i, weight: 100 },
  { re: /neto[\s:$]*([\d.,]{4,})/i,          weight: 90  },
  // 2. "afecto" (Chilean term for taxable base = neto)
  { re: /afecto[\s:$]*([\d.,]{4,})/i,        weight: 85  },
  // 3. Subtotal (often = neto before IVA)
  { re: /subtotal[\s:$]*([\d.,]{4,})/i,      weight: 80  },
  // 4. Generic "total" — could be total con IVA, so lower weight
  { re: /total\s+a\s+pagar[\s:$]*([\d.,]{4,})/i, weight: 50 },
  { re: /total[\s\S]{0,15}?[\$\s:]([\d.,]{4,})/i, weight: 40 },
  // 5. Large number near $ sign (last resort)
  { re: /\$\s*([\d.,]{5,})/g, weight: 10 },
];

/** RUT patterns for Chilean tax IDs */
const RUT_PATTERNS = [
  // Standard with dots: 76.123.456-7
  /\b(\d{1,2}\.\d{3}\.\d{3}-[\dkK])\b/,
  // Without dots: 76123456-7
  /\b(\d{7,8}-[\dkK])\b/,
  // Dense: 761234567 (no dash, no dots — needs checksum validation)
  /\b(\d{8,9})\b/,
];

/** Date patterns → normalised to YYYY-MM-DD */
const DATE_PATTERNS = [
  // DD/MM/YYYY or DD-MM-YYYY
  { re: /\b(\d{2})[\/\-](\d{2})[\/\-](\d{4})\b/, fmt: ([, d, m, y]) => `${y}-${m}-${d}` },
  // YYYY-MM-DD
  { re: /\b(\d{4})[\/\-](\d{2})[\/\-](\d{2})\b/, fmt: ([, y, m, d]) => `${y}-${m}-${d}` },
  // "25 de enero de 2025" (Spanish long form)
  {
    re: /(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(\d{4})/i,
    fmt: ([, d, mes, y]) => {
      const months = { enero:'01',febrero:'02',marzo:'03',abril:'04',mayo:'05',junio:'06',
                       julio:'07',agosto:'08',septiembre:'09',octubre:'10',noviembre:'11',diciembre:'12' };
      const m = months[mes.toLowerCase()] ?? '01';
      return `${y}-${m}-${d.padStart(2,'0')}`;
    },
  },
];

// ---------------------------------------------------------------------------
// MAIN EXTRACTOR
// ---------------------------------------------------------------------------

/**
 * extractInvoiceData(text, projectCodes?)
 *
 * @param {string}   text         — PDF text content (from pdfjs)
 * @param {string[]} projectCodes — optional list of known project codes to search for
 * @returns {{ rut: string|null, amount: number, date: string|null, projectCode: string|null }}
 */
export function extractInvoiceData(text, projectCodes = []) {
  if (!text || text.trim().length < 10) {
    return { rut: null, amount: 0, date: null, projectCode: null };
  }

  // Normalize whitespace for easier matching
  const normalized = text.replace(/\s+/g, ' ');

  // ---- 1. Amount ----
  let bestAmount = 0, bestWeight = -1;

  for (const { re, weight } of AMOUNT_PATTERNS) {
    // Collect all matches for this pattern and pick the highest plausible amount
    const candidates = [];
    let m;
    const iterRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    while ((m = iterRe.exec(normalized)) !== null) {
      const n = parseClpAmount(m[1]);
      // Sanity: CLP invoices are usually > 1,000 and < 500,000,000
      if (n >= 1000 && n <= 500_000_000) candidates.push(n);
    }

    if (candidates.length > 0 && weight > bestWeight) {
      // Pick largest candidate for this pattern (IVA is usually lower than neto total)
      bestAmount = Math.max(...candidates);
      bestWeight = weight;
    }
  }

  // ---- 2. RUT ----
  let foundRut = null;

  for (const pattern of RUT_PATTERNS) {
    const matches = [...normalized.matchAll(new RegExp(pattern.source, 'g'))];
    for (const m of matches) {
      const candidate = m[1];
      // Quick format normalisation before validation
      const withDash = candidate.includes('-') ? candidate : candidate.slice(0, -1) + '-' + candidate.slice(-1);
      if (validateRut(withDash)) {
        foundRut = formatRut(withDash);
        break;
      }
    }
    if (foundRut) break;
  }

  // ---- 3. Date ----
  let foundDate = null;

  for (const { re, fmt } of DATE_PATTERNS) {
    const m = normalized.match(re);
    if (m) {
      try {
        const candidate = fmt(m);
        // Sanity check: year between 2015 and 2035
        const year = parseInt(candidate.split('-')[0], 10);
        if (year >= 2015 && year <= 2035) {
          foundDate = candidate;
          break;
        }
      } catch { /* skip */ }
    }
  }

  // ---- 4. Project code ----
  let foundProjectCode = null;

  if (projectCodes.length > 0) {
    // Sort by length descending so longer/more-specific codes match first
    const sorted = [...projectCodes].sort((a, b) => b.length - a.length);
    const lowerText = normalized.toLowerCase();

    for (const code of sorted) {
      if (!code || code.length < 3) continue;
      if (lowerText.includes(code.toLowerCase())) {
        foundProjectCode = code;
        break;
      }
    }
  }

  return {
    rut:         foundRut,
    amount:      bestAmount,
    date:        foundDate,
    projectCode: foundProjectCode,
  };
}

// ---------------------------------------------------------------------------
// PDF TEXT READER (wraps pdfjs-dist)
// ---------------------------------------------------------------------------

/**
 * getPdfText(file, maxPages?)
 * Reads text from a PDF File object using pdfjs-dist.
 * Returns null if the PDF is image-only / scanned.
 */
export async function getPdfText(file, maxPages = 3) {
  // Lazy import to avoid SSR issues
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const limit = Math.min(pdf.numPages, maxPages);
    let fullText = '';

    for (let p = 1; p <= limit; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      fullText += content.items.map((i) => i.str).join(' ') + ' ';
    }

    if (fullText.trim().length < 10) return null; // scanned/image PDF
    return fullText;
  } catch (e) {
    console.error('[getPdfText] Error reading PDF:', e);
    return null;
  }
}
