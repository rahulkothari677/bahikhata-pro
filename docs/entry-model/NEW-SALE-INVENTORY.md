# New Sale — what the screen does (S3 inventory)

Taken 25 Oct 2026 from `components/ledger/TransactionEntry.tsx`, `ItemPicker.tsx`,
`layout/Header.tsx`, before Phase 7c's rebuild (changes C11, C12). Every later step
of the rebuild ticks this list on the real screen: each item still works, in no more
taps, unless the master plan says otherwise. Add to it when the screen gains a job.

| # | Job | Where | Step 1 (settings) | Step 2a (the List) |
|---|---|---|---|---|
| 1 | Title "New Sale / Purchase / Estimate / Credit / Debit Note" | entry header | ✓ unchanged | ✓ |
| 2 | Voice: whole sale when the bill is empty; "Add via Voice" once it has lines; 11 languages | entry header, phone header mic, Bill card, menu "Voice Entry" | switch `voiceEntry` | ✓ |
| 3 | Scan Bill (AI photo of a bill or list) — not on notes or estimates | entry header, phone header ✨, empty state | switch `aiScanner` | ✓ |
| 4 | Barcode camera from the search box; a barcode gun anywhere; unknown code → "New item?" | search box | switch `barcodeScanner` (camera only; the gun always works) | ✓ |
| 5 | Drafts: autosave, drafts list, leave-with-three-answers | entry header, leave guard | ✓ unchanged | ✓ |
| 6 | Search: 2–3 letters, Hindi words, a price, a code; "8 of N, keep typing"; close spellings | ItemPicker | ✓ unchanged | search rows now show in the list window, 30 before "keep typing" |
| 7 | Qty for the next item ("6, then tap or scan"); F4 — step 2c: the number pad with a unit (× 23, 400 g, 1.25 kg, 750 ml, ₹50); a packet takes whole counts only; number keys type into it on a computer | below search | switch `billQtyButton` | ✓ |
| 8 | Price check (sale): tap or scan shows price, nothing added; F6 | below search | switch `billPriceCheck` | ✓ |
| 9 | Often sold / Often bought rows, frozen while a bill is open; fold after 6 lines | ItemPicker | switch `billOftenList` | ★ Often is the first tab (24 best sellers, frozen while a bill is open); a long bill shortens the window instead of folding (#229) |
| 10 | The customer's usual items | ItemPicker | switch `billUsualList` | at the top of ★ Often (12) |
| 11 | Groups sheet: every group, then its whole list 60 at a time | ItemPicker | ✓ unchanged | Groups sheet replaced by group tabs (best sellers' groups first) and product tabs inside a big group; Side view puts groups in a column |
| 12 | Brand row: sizes as buttons, price beside a size, "out", ×qty, most-sold border | ItemPicker | switches `billSizeStock`, `billSizeMark` | one row per product, all sizes on that row (two-line buttons: size, then price / out / "2 left" / ×qty), − once on the bill |
| 13 | Single item row: name, price/unit, GST %, stock; stepper once on the bill | ItemPicker | ✓ unchanged | same row shape: its size from the name or "1 kg" for a loose good, price; stock only when low or out (as in the approved demo); − once on the bill |
| 14 | Empty shop: "Add Product" / "Scan a Bill" | ItemPicker empty | "Scan a Bill" follows `aiScanner` | ✓ |
| 15 | Bill lines: qty, unit, price, GST rate; sell by ₹ on loose; above-MRP said and fixed in one tap; ✕ with Undo | Bill card | ✓ unchanged | ✓ |
| 16 | Notes: load items from the original bill | Bill card | ✓ unchanged | ✓ |
| 17 | Customer / supplier: search, add party (GSTIN before State) | right column | ✓ unchanged | ✓ |
| 18 | Details: date, bill number, GST type, delivery / place of supply, discount, payment mode; Rule 46(e) and composition inter-state notices | right column | ✓ unchanged | ✓ |
| 19 | Rates include GST; update cost price (purchase) | right column | ✓ unchanged | ✓ |
| 20 | Summary: items, discount, GST, round-off (shop setting), total | right column | ✓ unchanged | ✓ |
| 21 | Notes field | below the bill | ✓ unchanged | ✓ |
| 22 | Phone bottom bar: total + Pay / Save; F10; Pay sheet (change, quick notes, UPI QR, part udhaar) | bottom | ✓ unchanged | ✓ |
| 23 | Purchase: asks for the supplier's bill number before saving | save | ✓ unchanged | ✓ |
| 24 | Keyboard: F2 search, F3 party, F4 qty, F6 price check, F10 pay/save, Esc clears | window | F4 / F6 follow their switches | ✓ |
| 25 | ⚙ Bill screen settings (new in step 1). **On a phone the bill header is hidden** (`hidden lg:flex`): the mic, ✨ scan and ⚙ sit in the app's top bar (Header.tsx); on a desktop in the bill header | top bar / bill header | new | ✓ |
| 26 | Loose good: weight buttons (250 g, 500 g, 1 kg, 2 kg; smaller for ₹400/kg and up), each adding that much; on the bill its amount with ✎ | List row | — | step 2b, switch `billWeightButtons` |
| 27 | ✎ on every product: the keypad bar (Amount 400 = 400 g, ₹ amount, Price) for a loose good; Packs (any count of a size) and Price (never above MRP) for a packed one; Big number pad option | List row → bar above the total bar | — | step 2b, switches `billPencil`, `billBigPad`, `billGramsRule`, `billCheckAmounts` |
