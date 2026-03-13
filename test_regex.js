import { extractInvoiceData } from './src/utils/parseInvoicePDF.js';

// The user has this in their PDF and it returns 0. Let's find out why.
const testTexts = [
  "RUT: 76.123.456-7 Total Neto $ 1.500.000 IVA $ 285.000 Total a Pagar $ 1.785.000",
  "RUT: 76.123.456-7 Monto Neto 1.500.000 Total 1.785.000",
  "Total 1500000",
  "Neto $1,500,000",
  "Afecto $ 1500000"
];

for(const t of testTexts) {
  const norm = t.replace(/\s+/g, ' ');
  console.log(`\nTesting: ${t}`);
  console.log(`Normalized: ${norm}`);
  console.log("Result:", extractInvoiceData(t));
}
