import { db } from '@/lib/db'
import { calculateGst, splitGst, roundMoney } from '@/lib/money'

// Indian shop demo data — Kirana / General Store
export async function seedDemoData(userId: string) {
  // Check if already seeded for this user
  const existing = await db.product.count({ where: { userId } })
  if (existing > 0) return { skipped: true }

  // 1. Create Settings
  await db.setting.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      shopName: 'Sharma Kirana Store',
      ownerName: 'Rajesh Sharma',
      address: 'Main Bazaar, Lucknow, UP - 226001',
      phone: '9876543210',
      gstin: '09ABCDE1234F1Z5',
      state: 'Uttar Pradesh',
      email: 'sharma.kirana@example.com',
    },
  })

  // 2. Create Products (typical kirana items)
  const products = [
    { name: 'Aashirvaad Atta 5kg', sku: 'ATA001', hsn: '1101', category: 'Flour', unit: 'pcs', purchasePrice: 240, salePrice: 280, mrp: 295, gstRate: 5, openingStock: 40, lowStockThreshold: 8 },
    { name: 'Tata Salt 1kg', sku: 'SLT001', hsn: '2501', category: 'Salt', unit: 'pcs', purchasePrice: 24, salePrice: 28, mrp: 30, gstRate: 0, openingStock: 100, lowStockThreshold: 15 },
    { name: 'Fortune Sunflower Oil 1L', sku: 'OIL001', hsn: '1512', category: 'Oil', unit: 'pcs', purchasePrice: 130, salePrice: 155, mrp: 165, gstRate: 5, openingStock: 50, lowStockThreshold: 10 },
    { name: 'Amul Taaza Milk 500ml', sku: 'MLK001', hsn: '0401', category: 'Dairy', unit: 'pcs', purchasePrice: 25, salePrice: 28, mrp: 30, gstRate: 0, openingStock: 60, lowStockThreshold: 12 },
    { name: 'Surf Excel 1kg', sku: 'DTR001', hsn: '3402', category: 'Detergent', unit: 'pcs', purchasePrice: 145, salePrice: 175, mrp: 185, gstRate: 18, openingStock: 25, lowStockThreshold: 5 },
    { name: 'Colgate Toothpaste 200g', sku: 'TTH001', hsn: '3306', category: 'Personal Care', unit: 'pcs', purchasePrice: 90, salePrice: 110, mrp: 115, gstRate: 18, openingStock: 30, lowStockThreshold: 6 },
    { name: 'Parle-G Biscuit 100g', sku: 'BSC001', hsn: '1905', category: 'Biscuits', unit: 'pcs', purchasePrice: 8, salePrice: 10, mrp: 10, gstRate: 18, openingStock: 200, lowStockThreshold: 30 },
    { name: 'Maggi Noodles 70g', sku: 'NDL001', hsn: '1902', category: 'Snacks', unit: 'pcs', purchasePrice: 12, salePrice: 14, mrp: 14, gstRate: 18, openingStock: 150, lowStockThreshold: 25 },
    { name: 'Basmati Rice 1kg', sku: 'RCE001', hsn: '1006', category: 'Rice', unit: 'kg', purchasePrice: 95, salePrice: 120, mrp: 130, gstRate: 0, openingStock: 80, lowStockThreshold: 15 },
    { name: 'Tata Tea Gold 500g', sku: 'TEA001', hsn: '0902', category: 'Tea', unit: 'pcs', purchasePrice: 240, salePrice: 285, mrp: 295, gstRate: 5, openingStock: 35, lowStockThreshold: 7 },
    { name: 'Sugar 1kg', sku: 'SUG001', hsn: '1701', category: 'Grocery', unit: 'kg', purchasePrice: 42, salePrice: 48, mrp: 50, gstRate: 0, openingStock: 90, lowStockThreshold: 20 },
    { name: 'Toor Dal 1kg', sku: 'DAL001', hsn: '0713', category: 'Pulses', unit: 'kg', purchasePrice: 130, salePrice: 150, mrp: 160, gstRate: 0, openingStock: 50, lowStockThreshold: 10 },
    { name: 'Lays Magic Masala 52g', sku: 'SNK001', hsn: '2005', category: 'Snacks', unit: 'pcs', purchasePrice: 18, salePrice: 20, mrp: 20, gstRate: 12, openingStock: 4, lowStockThreshold: 10 }, // low stock!
    { name: 'Dabur Honey 250g', sku: 'HNY001', hsn: '0409', category: 'Health', unit: 'pcs', purchasePrice: 145, salePrice: 175, mrp: 185, gstRate: 0, openingStock: 18, lowStockThreshold: 5 },
    { name: 'Lifebuoy Soap 125g', sku: 'SOP001', hsn: '3401', category: 'Personal Care', unit: 'pcs', purchasePrice: 28, salePrice: 35, mrp: 38, gstRate: 18, openingStock: 60, lowStockThreshold: 12 },
  ]

  const createdProducts = await Promise.all(
    products.map(p => db.product.create({ data: { ...p, userId } }))
  )

  // 3. Create Parties
  const parties = [
    { name: 'Ramesh Verma', type: 'customer', phone: '9988776655', state: 'Uttar Pradesh', openingBalance: 0 },
    { name: 'Sunita Devi', type: 'customer', phone: '9876512340', state: 'Uttar Pradesh', openingBalance: 500 },
    { name: 'Mohammed Irfan', type: 'customer', phone: '9700054321', state: 'Uttar Pradesh', openingBalance: 0 },
    { name: 'Anita Singh', type: 'customer', phone: '9456701234', state: 'Uttar Pradesh', openingBalance: -200 },
    { name: 'Mahalaxmi Suppliers', type: 'supplier', phone: '9000111222', gstin: '09XYZAB5678C1Z9', state: 'Uttar Pradesh', openingBalance: -1500 },
    { name: 'Amul Distributors', type: 'supplier', phone: '9112233445', gstin: '24AMUL1234D1Z1', state: 'Gujarat', openingBalance: 0 },
    { name: 'Tata Stores Wholesale', type: 'supplier', phone: '9334455667', state: 'Uttar Pradesh', openingBalance: 0 },
  ]

  const createdParties = await Promise.all(
    parties.map(p => db.party.create({ data: { ...p, userId } }))
  )

  // 4. Create transactions (last 60 days)
  const now = new Date()
  const customers = createdParties.filter(p => p.type === 'customer')
  const suppliers = createdParties.filter(p => p.type === 'supplier')

  const salesData: any[] = []
  const purchaseData: any[] = []

  for (let dayOffset = 60; dayOffset >= 0; dayOffset--) {
    const date = new Date(now)
    date.setDate(date.getDate() - dayOffset)
    date.setHours(10 + Math.floor(Math.random() * 8), Math.floor(Math.random() * 60))

    const salesCount = 1 + Math.floor(Math.random() * 4)
    for (let s = 0; s < salesCount; s++) {
      const customer = customers[Math.floor(Math.random() * customers.length)]
      const itemCount = 1 + Math.floor(Math.random() * 4)
      const items: any[] = []
      let subtotal = 0
      let cgst = 0, sgst = 0
      let profit = 0

      for (let i = 0; i < itemCount; i++) {
        const product = createdProducts[Math.floor(Math.random() * createdProducts.length)]
        const qty = 1 + Math.floor(Math.random() * 5)
        const unitPrice = product.salePrice
        const amount = qty * unitPrice
        // 🔒 FIX L5: Was `amount * product.gstRate / 100` — float-precision
        // (e.g., 0.30000000000000004). Now uses calculateGst from money.ts.
        const itemGst = calculateGst(amount, product.gstRate)
        const itemProfit = (product.salePrice - product.purchasePrice) * qty

        const { cgst: itemCgst, sgst: itemSgst } = splitGst(itemGst)
        items.push({
          productId: product.id,
          productName: product.name,
          quantity: qty,
          unitPrice,
          gstRate: product.gstRate,
          cgst: itemCgst,  // 🔒 FIX L9: per-item GST (was missing)
          sgst: itemSgst,
          igst: 0,
          total: amount + itemGst,
        })

        subtotal += amount
        // 🔒 FIX L5: Use the per-item split values (already computed above)
        cgst = roundMoney(cgst + itemCgst)
        sgst = roundMoney(sgst + itemSgst)
        profit += itemProfit
      }

      const discountAmount = Math.random() > 0.7 ? Math.floor(subtotal * 0.02) : 0
      const totalAmount = subtotal - discountAmount + cgst + sgst
      const isCredit = Math.random() > 0.75
      const paidAmount = isCredit ? Math.floor(totalAmount * 0.5) : totalAmount

      salesData.push({
        userId,
        type: 'sale',
        partyId: customer.id,
        date: new Date(date),
        subtotal,
        discountAmount,
        cgst,
        sgst,
        igst: 0,
        totalAmount,
        paidAmount,
        paymentMode: ['cash', 'upi', 'card'][Math.floor(Math.random() * 3)],
        isInterState: false,
        grossProfit: profit,
        items: { create: items },
        invoiceNo: `INV-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-${String(salesData.length + 1).padStart(3, '0')}`,
      })
    }

    if (dayOffset % 6 === 0) {
      const supplier = suppliers[Math.floor(Math.random() * suppliers.length)]
      const itemCount = 2 + Math.floor(Math.random() * 3)
      const items: any[] = []
      let subtotal = 0
      let cgst = 0, sgst = 0

      for (let i = 0; i < itemCount; i++) {
        const product = createdProducts[Math.floor(Math.random() * createdProducts.length)]
        const qty = 10 + Math.floor(Math.random() * 30)
        const unitPrice = product.purchasePrice
        const amount = qty * unitPrice
        // 🔒 FIX L5: Was `amount * product.gstRate / 100` — float-precision
        // (e.g., 0.30000000000000004). Now uses calculateGst from money.ts.
        const itemGst = calculateGst(amount, product.gstRate)

        const { cgst: itemCgst, sgst: itemSgst } = splitGst(itemGst)
        items.push({
          productId: product.id,
          productName: product.name,
          quantity: qty,
          unitPrice,
          gstRate: product.gstRate,
          cgst: itemCgst,  // 🔒 FIX L9: per-item GST (was missing)
          sgst: itemSgst,
          igst: 0,
          total: amount + itemGst,
        })

        subtotal += amount
        // 🔒 FIX L5: Use the per-item split values (already computed above)
        cgst = roundMoney(cgst + itemCgst)
        sgst = roundMoney(sgst + itemSgst)
      }

      const totalAmount = subtotal + cgst + sgst

      purchaseData.push({
        userId,
        type: 'purchase',
        partyId: supplier.id,
        date: new Date(date),
        subtotal,
        discountAmount: 0,
        cgst,
        sgst,
        igst: 0,
        totalAmount,
        paidAmount: totalAmount,
        paymentMode: 'bank',
        isInterState: false,
        grossProfit: 0,
        items: { create: items },
        invoiceNo: `PUR-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}-${String(purchaseData.length + 1).padStart(3, '0')}`,
      })
    }
  }

  for (const sale of salesData) {
    await db.transaction.create({ data: sale })
  }
  for (const purchase of purchaseData) {
    await db.transaction.create({ data: purchase })
  }

  // 5. Create some expenses
  const expenses = [
    { type: 'expense', category: 'Rent', date: new Date(now.getTime() - 30 * 86400000), subtotal: 12000, totalAmount: 12000, paidAmount: 12000, paymentMode: 'bank', notes: 'Monthly shop rent' },
    { type: 'expense', category: 'Electricity', date: new Date(now.getTime() - 15 * 86400000), subtotal: 2400, totalAmount: 2400, paidAmount: 2400, paymentMode: 'upi', notes: 'Electricity bill' },
    { type: 'expense', category: 'Salary', date: new Date(now.getTime() - 7 * 86400000), subtotal: 8000, totalAmount: 8000, paidAmount: 8000, paymentMode: 'cash', notes: 'Helper salary' },
    { type: 'expense', category: 'Telephone', date: new Date(now.getTime() - 5 * 86400000), subtotal: 599, totalAmount: 599, paidAmount: 599, paymentMode: 'upi', notes: 'Jio recharge' },
    { type: 'expense', category: 'Transport', date: new Date(now.getTime() - 3 * 86400000), subtotal: 350, totalAmount: 350, paidAmount: 350, paymentMode: 'cash', notes: 'Auto fare for goods pickup' },
  ]
  for (const exp of expenses) {
    await db.transaction.create({ data: { ...exp, userId } })
  }

  await db.transaction.create({
    data: {
      userId,
      type: 'income',
      category: 'Scrap Sale',
      date: new Date(now.getTime() - 10 * 86400000),
      subtotal: 800,
      totalAmount: 800,
      paidAmount: 800,
      paymentMode: 'cash',
      notes: 'Carton boxes sold to recycler',
    },
  })

  return {
    products: createdProducts.length,
    parties: createdParties.length,
    sales: salesData.length,
    purchases: purchaseData.length,
    expenses: expenses.length,
  }
}
