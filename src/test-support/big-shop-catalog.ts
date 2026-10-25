/**
 * A big general store, for tests and the LOCAL big-shop check (S4: 1,000+
 * items in brands and sizes). The same shop as the New Sale design demo Rahul
 * chose from (Downloads\EKBOOK-BILL-ENTRY-DESIGNS-V2-OCT-2026.html): 14 groups,
 * ~320 product lines, ~1,200 items, loose goods beside the packed brands.
 *
 * Prices and GST rates are illustrative, never a rate table. Used by
 * __tests__/lib/pick-rows-list.test.ts and scripts/seed-big-shop.ts.
 */

export interface CatalogItem {
  name: string
  category: string
  /** The brand row this item is one size of; absent = an item on its own. */
  family?: string
  sizeLabel?: string
  unit: 'pcs' | 'kg' | 'ltr'
  price: number
  gst: number
  stock: number
}

export function bigShopCatalog(): CatalogItem[] {
  const out: CatalogItem[] = []
  let seq = 0
  const push = (o: Omit<CatalogItem, 'stock' | 'unit' | 'gst'> & Partial<CatalogItem>) => {
    seq++
    out.push({ unit: 'pcs', gst: 5, stock: 4 + (seq * 7) % 40, ...o })
  }
  const line = (cat: string, label: string, sizes: [string, number][], base: number, gst = 5) =>
    sizes.forEach(([s, f]) => push({ category: cat, family: label, sizeLabel: s, name: `${label} ${s}`, price: Math.max(1, Math.round(base * f)), gst }))
  const packs = (cat: string, label: string, list: number[], gst = 5) =>
    list.forEach((p) => push({ category: cat, family: label, sizeLabel: `₹${p}`, name: `${label} ₹${p}`, price: p, gst }))
  const loose = (cat: string, label: string, price: number, unit: 'kg' | 'ltr' | 'pcs', gst = 0) =>
    push({ category: cat, name: label, price, unit, gst, stock: unit === 'pcs' ? 300 : 60 })

  const A = 'Atta & flour'
  ;['Aashirvaad', 'Fortune', 'Pillsbury', 'Annapurna', 'Patanjali', 'Shaktibhog', 'Rajdhani', 'Nature Fresh', 'Tata Sampann', 'Golden Harvest'].forEach((b, k) =>
    line(A, `${b} Atta`, [['1 kg', 1], ['2 kg', 1.95], ['5 kg', 4.7], ['10 kg', 9.1], ['20 kg', 17.8]], 52 + k * 2))
  loose(A, 'Chakki Atta (loose)', 40, 'kg')
  ;['Rajdhani', 'Tata Sampann', 'Fortune', 'Aashirvaad', 'Patanjali', 'Shaktibhog'].forEach((b, k) => line(A, `${b} Besan`, [['500 g', 1], ['1 kg', 1.9], ['2 kg', 3.7]], 62 + k * 3))
  loose(A, 'Besan (loose)', 110, 'kg')
  ;['Rajdhani', 'Fortune', 'Aashirvaad', 'Shaktibhog', 'Patanjali'].forEach((b, k) => {
    line(A, `${b} Maida`, [['500 g', 1], ['1 kg', 1.85]], 28 + k * 2)
    line(A, `${b} Suji`, [['500 g', 1], ['1 kg', 1.85]], 31 + k * 2)
  })
  const R = 'Rice & dal'
  ;([['Toor Dal', 140], ['Moong Dal', 120], ['Chana Dal', 90], ['Masoor Dal', 95], ['Urad Dal', 130], ['Rajma', 150], ['Kabuli Chana', 140]] as [string, number][])
    .forEach(([n, p]) => loose(R, `${n} (loose)`, p, 'kg'))
  ;['Tata Sampann', 'Fortune'].forEach((b, k) => line(R, `${b} Toor Dal`, [['500 g', 1], ['1 kg', 1.9]], 85 + k * 6))
  ;([['Basmati Rice', 110], ['Sona Masoori Rice', 62], ['Kolam Rice', 70]] as [string, number][]).forEach(([n, p]) => loose(R, `${n} (loose)`, p, 'kg'))
  ;['India Gate', 'Daawat', 'Kohinoor', 'Fortune', 'Lal Qilla'].forEach((b, k) => line(R, `${b} Basmati Rice`, [['1 kg', 1], ['5 kg', 4.6]], 130 + k * 8))
  ;([['Poha', 60], ['Sabudana', 90]] as [string, number][]).forEach(([n, p]) => loose(R, `${n} (loose)`, p, 'kg'))
  const S = 'Sugar & salt'
  loose(S, 'Sugar (loose)', 44, 'kg', 5); loose(S, 'Gud (loose)', 60, 'kg')
  ;['Madhur', 'Dhampure'].forEach((b, k) => line(S, `${b} Sugar`, [['1 kg', 1], ['5 kg', 4.7]], 52 + k * 3))
  ;([['Tata Salt', 28], ['Tata Salt Lite', 45], ['Catch Salt', 25], ['Aashirvaad Salt', 27], ['Saffola Salt', 38]] as [string, number][])
    .forEach(([n, p]) => line(S, n, [['1 kg', 1]], p, 0))
  const O = 'Oil & ghee'
  ;([['Sunflower Oil', ['Fortune', 'Saffola', 'Sundrop', 'Gold Drop', 'Freedom']], ['Mustard Oil', ['Fortune', 'Dhara', 'Patanjali', 'Engine', 'P Mark']], ['Soya Oil', ['Fortune', 'Nature Fresh', 'Ruchi Gold', 'Mahakosh']]] as [string, string[]][])
    .forEach(([t, bs], ti) => bs.forEach((b, k) => line(O, `${b} ${t}`, [['500 ml', 0.52], ['1 L', 1], ['2 L', 1.97], ['5 L', 4.8], ['15 L', 14]], 140 + ti * 15 + k * 5)))
  loose(O, 'Mustard Oil (loose)', 170, 'ltr', 5)
  ;['Amul', 'Patanjali', 'Gowardhan', 'Mother Dairy', 'Nandini'].forEach((b, k) => line(O, `${b} Ghee`, [['200 ml', 0.22], ['500 ml', 0.52], ['1 L', 1]], 640 - k * 15))
  const T = 'Tea & coffee'
  ;['Tata Tea Premium', 'Red Label', 'Taj Mahal', 'Wagh Bakri', 'Tata Tea Gold', 'Society', 'Tata Tea Agni', 'Lipton', 'Girnar', 'Duncans'].forEach((b, k) =>
    line(T, `${b} Tea`, [['100 g', 0.42], ['250 g', 1], ['500 g', 1.95], ['1 kg', 3.8]], 120 + k * 4))
  ;['Nescafe Classic', 'Bru Instant', 'Davidoff', 'Continental'].forEach((b, k) => line(T, `${b} Coffee`, [['50 g', 1], ['100 g', 1.9], ['200 g', 3.6]], 175 + k * 20))
  const SPICES = ['Haldi', 'Mirch', 'Dhaniya', 'Jeera', 'Garam Masala', 'Chana Masala', 'Kitchen King', 'Chhole Masala', 'Sabzi Masala', 'Pav Bhaji Masala', 'Chaat Masala', 'Kasuri Methi']
  const SPICE_BRANDS = ['MDH', 'Everest', 'Catch', 'Badshah', 'Patanjali', 'Tata Sampann', 'Aashirvaad', 'Eastern', 'Ramdev', 'Sakthi']
  SPICES.forEach((t, ti) => SPICE_BRANDS.forEach((b, bi) => line('Spices', `${b} ${t}`, [['50 g', 1], ['100 g', 1.85], ['200 g', 3.5], ['500 g', 8.2], ['1 kg', 15.5]], 20 + ti * 3 + bi * 2)))
  ;([['Kaju', 900], ['Badam', 800], ['Kishmish', 400], ['Peanuts', 140], ['Makhana', 1200], ['Akhrot', 1000]] as [string, number][])
    .forEach(([n, p]) => loose('Dry fruits', `${n} (loose)`, p, 'kg', 5))
  line('Dry fruits', 'Happilo Kaju', [['200 g', 1], ['500 g', 2.4]], 240)
  ;([['Onion', 40], ['Potato', 30], ['Tomato', 50], ['Garlic', 200], ['Ginger', 160], ['Green Chilli', 80]] as [string, number][])
    .forEach(([n, p]) => loose('Vegetables', n, p, 'kg'))
  const B = 'Biscuits'
  ;([['Parle', 'Parle-G', [5, 10, 20, 50]], ['Britannia', 'Good Day', [10, 20, 30, 40]], ['Britannia', 'Marie Gold', [10, 30, 45]], ['Britannia', 'Bourbon', [10, 30, 50]], ['Parle', 'Monaco', [10, 20, 35]],
    ['Parle', 'Hide & Seek', [10, 30, 50]], ['Sunfeast', 'Dark Fantasy', [10, 40, 80]], ['Cadbury', 'Oreo', [10, 30, 50]], ['Parle', 'Krackjack', [10, 20, 35]], ['Britannia', '50-50', [10, 20, 35]],
    ['Britannia', 'Milk Bikis', [10, 20, 30]], ['Britannia', 'Jim Jam', [10, 30, 50]], ['Britannia', 'Tiger', [5, 10, 20]], ['Sunfeast', "Mom's Magic", [10, 30, 50]], ['Britannia', 'Rusk', [20, 40, 80]], ['Parle', '20-20', [5, 10, 30]]] as [string, string, number[]][])
    .forEach(([b, l, ps]) => packs(B, l === 'Parle-G' ? l : `${b} ${l}`, ps))
  const N = 'Snacks'
  ;['Classic Salted', 'Magic Masala', 'Cream & Onion', 'Spanish Tomato', 'Chile Limon', 'Hot n Sweet', 'American Style'].forEach((l) => packs(N, `Lays ${l}`, [5, 10, 20, 50]))
  ;['Masala Munch', 'Chilli Chatka', 'Green Chutney', 'Solid Masti', 'Puffcorn', 'Naughty Tomatoes'].forEach((l) => packs(N, `Kurkure ${l}`, [5, 10, 20, 50]))
  ;['Aloo Bhujia', 'Moong Dal', 'Navratan', 'Khatta Meetha', 'Bhujia Sev', 'Nut Cracker', 'Panchratan', 'Diet Mixture'].forEach((l, k) => line(N, `Haldiram's ${l}`, [['200 g', 1], ['400 g', 1.9], ['1 kg', 4.4]], 52 + k * 3))
  ;['Bhujia', 'Moong Dal', 'Navratan', 'Khatta Meetha', 'Ratlami Sev', 'Chana Jor'].forEach((l, k) => line(N, `Bikaji ${l}`, [['200 g', 1], ['400 g', 1.9], ['1 kg', 4.4]], 50 + k * 3))
  loose(N, 'Eclairs Toffee (loose)', 1, 'pcs', 5); loose(N, 'Pulse Candy (loose)', 1, 'pcs', 5)
  const Y = 'Noodles & breakfast'
  ;([['Maggi', [['₹14', 14], ['4-pack', 56], ['8-pack', 108], ['12-pack', 160]]], ['Yippee', [['₹15', 15], ['4-pack', 60]]], ['Knorr Soupy', [['₹15', 15], ['4-pack', 58]]]] as [string, [string, number][]][])
    .forEach(([b, s]) => s.forEach(([l, p]) => push({ category: Y, family: `${b} Noodles`, sizeLabel: l, name: `${b} Noodles ${l}`, price: p })))
  ;([["Kellogg's", 'Corn Flakes', 120], ['Quaker', 'Oats', 99], ['Saffola', 'Oats', 95]] as [string, string, number][]).forEach(([b, t, p]) => line(Y, `${b} ${t}`, [['250 g', 1], ['500 g', 1.85], ['1 kg', 3.5]], p))
  const D = 'Dairy & bread'
  ;([['Amul Gold', 'Milk', [['500 ml', 1], ['1 L', 2]], 34, 0], ['Amul Taaza', 'Milk', [['500 ml', 1], ['1 L', 2]], 28, 0], ['Amul', 'Butter', [['100 g', 1], ['500 g', 4.9]], 58, 5],
    ['Mother Dairy', 'Dahi', [['200 g', 1], ['400 g', 1.8], ['1 kg', 4]], 20, 5], ['Britannia', 'Bread', [['400 g', 1]], 45, 0], ['Amul', 'Paneer', [['200 g', 1]], 90, 0]] as [string, string, [string, number][], number, number][])
    .forEach(([b, t, s, p, g]) => line(D, `${b} ${t}`, s, p, g))
  loose(D, 'Eggs', 7, 'pcs'); loose(D, 'Paneer (loose)', 400, 'kg')
  const P = 'Personal care'
  ;['Lifebuoy', 'Lux', 'Dettol', 'Santoor', 'Dove', 'Pears', 'Cinthol', 'Medimix', 'Godrej No.1', 'Hamam'].forEach((b, k) => line(P, `${b} Soap`, [['100 g', 1], ['125 g', 1.2], ['Pack of 3', 2.8], ['Pack of 4', 3.6]], 32 + k * 3))
  ;['Clinic Plus', 'Head & Shoulders', 'Sunsilk', 'Dove', 'Pantene', 'TRESemme', 'Chik', 'Meera'].forEach((b, k) => {
    push({ category: P, family: `${b} Shampoo`, sizeLabel: '₹2', name: `${b} Shampoo ₹2`, price: 2, stock: 40 })
    line(P, `${b} Shampoo`, [['80 ml', 1], ['180 ml', 2.2], ['340 ml', 4], ['650 ml', 7.2]], 60 + k * 6)
  })
  ;['Colgate', 'Pepsodent', 'Close Up', 'Sensodyne', 'Dabur Red'].forEach((b, k) => line(P, `${b} Toothpaste`, [['50 g', 0.55], ['100 g', 1], ['200 g', 1.9]], 55 + k * 6))
  const C = 'Cleaning'
  ;['Surf Excel Easy Wash', 'Ariel Matic', 'Tide Plus', 'Rin', 'Wheel', 'Ghadi', 'Nirma', 'Henko'].forEach((b, k) => line(C, b, [['500 g', 0.5], ['1 kg', 1], ['2 kg', 1.95], ['4 kg', 3.8], ['6 kg', 5.6]], 120 - k * 8, 18))
  ;([['Vim', [10, 20, 35]], ['Exo', [10, 20, 35]], ['Pril', [10, 20, 35]]] as [string, number[]][]).forEach(([b, ps]) => packs(C, `${b} Dishwash Bar`, ps, 18))
  ;['Harpic', 'Domex', 'Sanifresh'].forEach((b, k) => line(C, `${b} Toilet Cleaner`, [['500 ml', 1], ['1 L', 1.9]], 99 - k * 6, 18))
  ;['Lizol', 'Colin'].forEach((b, k) => line(C, `${b} Floor Cleaner`, [['500 ml', 1], ['1 L', 1.9], ['2 L', 3.6]], 109 - k * 6, 18))
  return out
}
