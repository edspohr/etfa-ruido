import { extractInvoiceData, validateRut, formatRut } from './src/utils/parseInvoicePDF.js';

// Let's redefine the fixes locally to test
function parseClpAmountFix(raw) {
  if (!raw) return 0;
  let s = String(raw).trim().replace(/\$/g, '');
  // CLP format in Chile often uses DOTS as thousands separators and COMMAS for decimals.
  // E.g., "1.500.000", but some systems use "1,500,000".
  
  // If we see ",00", ",0" or ",000" at the very end, it might be decimals.
  // Actually, simplest is: remove ALL dots and commas if they are followed by exactly 3 digits (thousands).
  // Wait, no. Just remove all spaces, dots, and commas, then check if last two are decimals?
  // Most Chilean invoices don't have decimals. If they do, they are ",00"
  
  // A safe approach:
  s = s.replace(/\s+/g, '');
  
  // If it matches exactly \d{1,3}(,\d{3})+ (e.g. 1,500,000), then commas are thousands separators
  if (/^\d{1,3}(,\d{3})+$/.test(s)) {
      s = s.replace(/,/g, '');
  }
  // If it matches exactly \d{1,3}(\.\d{3})+ (e.g. 1.500.000)
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, '');
  }
  // Otherwise, if it has both dots and commas, assume the last one is the decimal
  else {
      s = s.replace(/[.,]\d{1,2}$/, ''); // chop off decimals
      s = s.replace(/[.,]/g, ''); // remove remaining thousand separators
  }
  
  s = s.replace(/[^\d]/g, '');
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
}

console.log("parseClpAmountFix('1.500.000'):", parseClpAmountFix('1.500.000'));
console.log("parseClpAmountFix('1,500,000'):", parseClpAmountFix('1,500,000'));
console.log("parseClpAmountFix('1500000'):", parseClpAmountFix('1500000'));
console.log("parseClpAmountFix('1.500.000,00'):", parseClpAmountFix('1.500.000,00'));

const RUT_PATTERNS_FIX = [
  // \b fails because of the hyphen. Use a lookaround or just spaces
  /(?:\s|^|RUT:?\s*)(\d{1,2}\.\d{3}\.\d{3}-[\dkK])(?:\s|$)/i,
  /(?:\s|^|RUT:?\s*)(\d{7,8}-[\dkK])(?:\s|$)/i,
];

let text = "RUT: 76.123.456-7 Monto Neto 1.500.000 Total 1.785.000";
for(let p of RUT_PATTERNS_FIX) {
  let matches = [...text.matchAll(new RegExp(p.source, 'ig'))];
  for(let m of matches) {
      console.log("Found RUT match:", m[1]);
  }
}
