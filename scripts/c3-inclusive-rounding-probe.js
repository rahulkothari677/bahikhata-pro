// C3 probe: for a GST-INCLUSIVE line, can we satisfy BOTH constraints at once?
//
//   (A) PORTAL RULE   tax === round(taxable * rate / 100)
//       GSTR-1 sends txval (= qty*unitPrice - discount) and camt/samt/iamt
//       separately; the portal validates tax against txval * rate.
//
//   (B) CUSTOMER RULE taxable + tax === grossInclusive  (the MRP the customer pays)
//
// All values in integer PAISE, which is how the DB stores money.

const RATES = [5, 12, 18, 28]

function taxFrom(taxable, rate) {
  return Math.round((taxable * rate) / 100)
}

let checked = 0
let impossible = 0
const examples = []

for (const rate of RATES) {
  // Sweep realistic inclusive line totals: 1 paisa .. 200000 paise (Rs 2000)
  for (let gross = 1; gross <= 200000; gross++) {
    checked++
    // Is there ANY integer taxable T with T + round(T*rate/100) === gross?
    // T must be near gross*100/(100+rate); check a window around it.
    const approx = Math.round((gross * 100) / (100 + rate))
    let found = false
    for (let t = approx - 3; t <= approx + 3; t++) {
      if (t < 0) continue
      if (t + taxFrom(t, rate) === gross) { found = true; break }
    }
    if (!found) {
      impossible++
      if (examples.length < 8) {
        const t = approx
        examples.push({
          rate,
          grossPaise: gross,
          grossRupees: (gross / 100).toFixed(2),
          bestTaxable: t,
          tax: taxFrom(t, rate),
          sum: t + taxFrom(t, rate),
          offBy: t + taxFrom(t, rate) - gross,
        })
      }
    }
  }
}

console.log('Inclusive-price line totals checked :', checked)
console.log('Cases where BOTH rules cannot hold  :', impossible)
console.log('Percentage impossible               :', ((impossible / checked) * 100).toFixed(2) + '%')
console.log('\nExamples (paise):')
for (const e of examples) {
  console.log(
    `  rate ${String(e.rate).padStart(2)}%  MRP Rs ${e.grossRupees.padStart(9)}  ` +
    `taxable ${String(e.bestTaxable).padStart(7)} + tax ${String(e.tax).padStart(6)} = ${String(e.sum).padStart(7)} ` +
    `(off by ${e.offBy > 0 ? '+' : ''}${e.offBy} paisa)`,
  )
}

// Specifically the case from the audit report: Rs 100 MRP at 18%
console.log('\nThe Rs 100 @ 18% case from the report:')
const g = 10000
for (let t = 8470; t <= 8480; t++) {
  const tax = taxFrom(t, 18)
  const mark = t + tax === g ? '  <== EXACT MATCH' : ''
  console.log(`  taxable ${t} + tax ${tax} = ${t + tax}${mark}`)
}
