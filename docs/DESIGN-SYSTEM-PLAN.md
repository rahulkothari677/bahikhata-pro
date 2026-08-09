# Making EkBook look like the best app on the phone, not another ledger app

**Written 2026-08-09.** Rahul: *"right now it looks like a very basic design and what I want is to make it like one of the best fintech app… better than all the top existing app."*

This is the research, the diagnosis, and the execution plan. It starts with Account because that is where we started, but the point of Phase 1 is that it stops being about Account at all — it becomes the vocabulary the whole app is rebuilt in.

---

## Part 0 — Why the app looks basic

Not because the colours are wrong. Because there is no **design system**, and every screen makes its own decisions.

Measured in the codebase on 2026-08-09:

Counted across `src/components/**/*.tsx`:

| Symptom | Measured | What it means |
|---|---|---|
| `rounded-*` class usages | **551** across 6 different radii | Every card picks its own shape by hand |
| `text-3xs` (~10px) usages | **262** | The smallest size in the app is one of its most used — on real content, for users who often cannot read English comfortably |
| `shadow-card` usages | **195**, one elevation value | Nothing on screen can look more important than anything else |
| Card container | `bg-card rounded-2xl border border-border/60 shadow-card p-4` retyped per card | No `<Section>` primitive; a change to card style is a 195-file edit |
| Icon colour | `bg-blue-100 dark:bg-blue-950`, `bg-amber-100`, `bg-rose-100`… chosen per row | Colour is decoration, not meaning |
| Spacing | `gap-2`, `gap-2.5`, `gap-3`, `p-3`, `p-3.5`, `p-4`, `p-5` mixed freely | No rhythm |

Those three numbers — 551, 262, 195 — are the whole diagnosis. A system would have roughly 3, 0 and 4.

An app looks "premium" when a user's eye can predict the next screen before it loads. Predictability comes from **a small number of decisions applied everywhere** — not from any single beautiful screen. Right now EkBook has beautiful *pieces* (the business cards, the invoice themes) sitting in a shell that improvises.

**This is the single highest-leverage change available**, and it is why Phase 1 below is not "redesign Account" but "extract the primitives, prove them on Account".

---

## Part 1 — What the best apps actually do

Researched across fintech and outside it, because the ask was explicitly not fintech-only.

### 1.1 The rule that shows up everywhere: four or five top-level groups

Apple's own guidance for Settings is to keep top-level categories to four or five and use section headings to group related options, so a screen stays scannable rather than becoming a list ([Apple HIG — Settings](https://developers.apple.com/design/human-interface-guidelines/patterns/settings/), [Toptal](https://www.toptal.com/designers/ux/settings-ux)).

The iOS Settings app is the reference implementation of hierarchical IA — thousands of settings, never overwhelming, because everything is in a predictable group ([bricxlabs](https://bricxlabs.com/blogs/settings-page-ui-examples)).

**EkBook now:** five groups. ✅ Done in the previous change.

### 1.2 Progressive disclosure — the strongest single pattern

N26 uses progressive disclosure across its entire flow: simple view by default, deeper detail one tap away ([craftinnovations](https://craftinnovations.global/banking-onboarding-best-practices-revolut-nubank-monzo/)).

Notion, Slack and Stripe are the benchmark settings pages precisely because they group toggles into predictable categories, offer real-time search, and hide advanced options until explicitly requested ([memorable.design](https://memorable.design/saas-settings-page-examples/)).

The 2026 pattern across admired products is *removing everything that does not serve the immediate task*, and surfacing the one metric that answers "is everything okay?" before letting people drill in ([saasui](https://www.saasui.design/blog/7-saas-ui-design-trends-2026), [925studios](https://www.925studios.co/blog/saas-dashboard-design-examples-2026)).

**EkBook now:** Feature Toggles is 21 switches in one list, 3.3 screens tall. Appearance is 2 screens. No page collapses anything. ❌ Phase 3.

### 1.3 Discipline about what is on screen

Monzo keeps its home screen to five actions — described as discipline, not limitation: cutting everything a user will not touch in their first five sessions ([craftinnovations](https://craftinnovations.global/banking-onboarding-best-practices-revolut-nubank-monzo/)).

**EkBook now:** the Account header was 779px of chrome before the first menu row. Fixed to 384. But the dashboard still shows ~20 cards at once. ❌ Phase 5.

### 1.4 Search as the escape hatch

Elite settings pages leverage real-time search ([memorable.design](https://memorable.design/saas-settings-page-examples/)). Linear's command palette — every action behind one keystroke — is called out as belonging in every modern design system ([Muzli](https://medium.muz.li/12-ui-patterns-designers-copy-from-top-saas-products-e68d54ade5e8)).

**EkBook now:** there is a global Ctrl+K search, but Account itself has no search, and Feature Toggles has a search box that only filters that one page. A shopkeeper looking for "round off" has to know it lives under Invoices. ❌ Phase 3.

### 1.5 Tonal elevation instead of shadows

Material 3 represents elevation mainly through **tonal colour overlays** rather than shadows, with levels 1–5 tinting the surface more strongly as elevation rises — and this works in both light and dark mode ([m3.material.io](https://m3.material.io/styles/elevation/applying-elevation), [designfornative](https://designfornative.com/basics-of-elevation-on-android/)). M3 also standardises list heights for predictable layouts and uses shape as a deliberate brand tool ([supercharge.design](https://supercharge.design/blog/material-3-expressive)).

**EkBook now:** one `shadow-card` everywhere, `border-border/60` everywhere, flat hierarchy. Cards do not communicate importance. ❌ Phase 1.

### 1.6 Typography as the main lever

Zerodha is described as deliberately understated — consistent Inter weights, information clarity over decoration, tight 8–12px internal padding and 16–24px gaps between sections — creating a trustworthy, professional feel ([The Design Index](https://www.thedesignindex.co/designs/zerodha-com)). 14px is the standard mobile base size ([Ramotion](https://www.ramotion.com/blog/typography-in-app-design/), [Medium — fintech type](https://medium.com/@tamannasamantaray00/typography-selection-for-fintech-product-design-system-series-62ba0ba7c4bf)).

**EkBook now:** already on Inter, which is the right call. But eight ad-hoc sizes including `text-3xs` (~10px) used for real content — below comfortable reading for the target user. ❌ Phase 1.

### 1.7 The one that matters most for *this* audience

This is where EkBook can genuinely beat Revolut and CRED, because they are not designing for this user.

Research on emergent users in India is consistent:

- For users in smaller towns, the smartphone is often the **first and only computing device**, requiring simpler, guided, visually-driven experiences ([createbytes](https://createbytes.com/insights/ux-design-mobile-apps-india)).
- **Over 50% of new fintech users prefer regional languages**; apps should let users switch language *anywhere*, not only at onboarding ([billcut](https://www.billcut.com/blogs/fintech-ux-design-for-bharat-simple-apps-for-everyone/)).
- Universal icons **with** text labels aid comprehension for semi-literate users; colour-coded interfaces work well in low-literacy, multi-language settings ([ACM](https://dl.acm.org/doi/10.1145/3449210), [academia.edu](https://www.academia.edu/3604900/Mobile_interface_design_for_low_literacy_populations)).
- Conversational microcopy in the vernacular reduces error anxiety and builds confidence ([billcut](https://www.billcut.com/blogs/fintech-ux-design-for-bharat-simple-apps-for-everyone/)).

**EkBook now:** measured today — with Hindi selected, the Account screen was **32% Hindi**. Row labels translated; their descriptions did not, because 126 `nav.desc.*` translations existed in `i18n.ts` and nothing rendered them. Raised to **79%** in this pass. Still English: the "SOON" badge, plan names, and several deeper pages which are ~11% translated. ⚠️ Phase 2.

---

## Part 2 — The gap, stated plainly

| # | Gap | Evidence | Phase |
|---|---|---|---|
| G1 | No design system; every screen improvises | 6 radii, 8 type sizes, hand-repeated card classes | 1 |
| G2 | Flat hierarchy — nothing looks more important than anything else | one shadow, one border, everywhere | 1 |
| G3 | Deeper pages are mostly English for a Hindi user | Shop Profile 11% Hindi | 2 |
| G4 | No progressive disclosure | Feature Toggles = 21 switches, 3.3 screens | 3 |
| G5 | No search within Account | 16 pages, no way to find "round off" | 3 |
| G6 | Device-local settings silently reset | theme/language/dark mode/notifications in localStorage only | 4 |
| G7 | Empty states are dead ends | "No staff members yet", "0 Products" with no next step | 5 |
| G8 | No motion language | no transitions between Account pages | 6 |

---

## Part 3 — Execution plan

Ordered so each phase makes the next cheaper. Phases 1–3 are the ones that change how the app *feels*.

### Phase 1 — The design system (the foundation)

**Goal:** one file that decides shape, space, type and elevation; Account rebuilt on it as the proof.

1. `src/lib/design-tokens.ts` + CSS variables:
   - **Type scale**: 5 steps, not 8. `display / title / body / label / caption`. Minimum body 14px; retire `text-3xs` for anything a user must read.
   - **Space scale**: 4-point grid → `xs 4 / sm 8 / md 12 / lg 16 / xl 24 / 2xl 32`. Delete `p-3.5`, `gap-2.5`.
   - **Radius**: 3 values — `sm 8` (chips), `md 12` (controls), `lg 16` (cards). Retire the rest.
   - **Elevation**: M3-style tonal levels 0–3 as surface tints that work in dark mode, replacing the single `shadow-card`.
2. `<Section>`, `<Row>`, `<Group>` primitives in `src/components/ui/`. A settings row becomes `<Row icon label description trailing />`, not 20 lines of Tailwind.
3. **Semantic icon colours**: today blue/amber/rose are decorative. Bind them to meaning — money, stock, compliance, danger — so colour teaches instead of decorating.
4. Rebuild the 16 Account pages on the primitives. Expect a large net deletion of markup.
5. Guardrail test: no raw `rounded-*`/`text-*` outside the token layer for new components (the repo already has a microtypography test to extend).

**Exit:** every Account row renders through one component. Changing card radius app-wide is a one-line edit.

### Phase 2 — Finish the vernacular

6. Sweep every hardcoded English string in Account's deeper pages into `i18n.ts` (Shop Profile is 11% translated; Invoices, Preferences, Data & Backup similar).
7. Extend beyond en/hi — gu/mr/ta/te currently fall back to English for most new keys.
8. Add a **language switch reachable from anywhere**, not just Appearance (research: users expect to switch at any point).
9. Guardrail test: fail the build when a component in `settings/` or `layout/` contains a user-visible English string literal not routed through `t()`.

**Exit:** a Hindi shopkeeper never sees English except proper nouns and GSTIN.

### Phase 3 — Progressive disclosure + search

10. **Search inside Account.** One field at the top of the menu, searching every setting across all 16 pages by label, description and keyword — jumping straight to the control. The registry already carries `keywords`; this is mostly wiring.
11. **Collapse Feature Toggles** into its existing categories, collapsed by default with an "N on" summary per category.
12. **Two-tier pages:** each page shows the common controls; advanced ones sit behind "Advanced". Concretely — Invoices shows design + how bills are sent; round-off and e-invoicing move under Advanced.
13. **Answer "is everything okay?" first.** A single status line at the top of Account: profile complete, backup age, period lock state, plan.

**Exit:** no Account page taller than ~2 screens; any setting reachable in ≤2 actions.

### Phase 4 — Make settings follow the shopkeeper

14. Move `notifPrefs`, `themeColor`, `language`, `darkMode` from localStorage to the `Setting` row, with localStorage as cache. Today a reinstall or a new phone silently resets all of them.
15. One migration on first load after upgrade: local values win once, then the server is authoritative.

**Exit:** buy a new phone, sign in, everything looks and behaves the same. Also removes a fundraising-diligence smell — user preferences currently do not exist server-side.

### Phase 5 — Empty states and first-run

16. Every empty state gets an illustration, one sentence of plain language, and one primary action. "No staff members yet" → "Add your first helper so they can bill without seeing your profit."
17. Zero-state Account: for a brand-new shop, lead with the three things that matter (shop name, GSTIN, UPI) instead of showing 18 rows.

### Phase 6 — Motion and polish

18. Shared-element transition from Account row → page (the row's icon becomes the page header icon). This is the single cheapest thing that makes an app feel expensive.
19. 150–200ms ease-out for page transitions, honouring `prefers-reduced-motion`.
20. Haptics on destructive confirmations only — currently fired broadly.

### Phase 7 — Roll the system outward

21. Apply Phases 1–6 to Dashboard, then Ledger, Parties, Inventory, Reports.
22. Dashboard is the biggest win after Account: ~20 cards competing, no hierarchy. Same treatment — one "is everything okay?" answer, then drill-down.

---

## Part 4 — Verification log (2026-08-09)

Every control on all sixteen Account pages, clicked against a real database.

**Inventory:** 34 switches · 5 dropdowns · 20 inputs · ~50 buttons.

### Working and persisting ✅

| Page | Verified |
|---|---|
| Invoices & Bills | 3 switches → `PUT /api/settings` 200; theme + send format persisted server-side |
| Preferences | Hide Profit, overselling persist |
| Shop Profile | Save writes and persists; QR, Share, Copy vCard render |
| Accounting Controls | Run Health Check executes, reports "All checks passed" |
| Data & Backup | Backup Now downloads |
| Staff & Access | Add Staff dialog opens with name/email/password |
| Subscription | 3 plan cards render inline; Monthly/Yearly toggle works |
| Security | App lock: set, lock, wrong PIN rejected, correct PIN opens, removal requires PIN |
| About | Version, Privacy, Terms, Replay Tour, Replay Theme Picker |

### Fixed this pass 🔧

- **Hide Profit erased other settings.** `updateHideProfit` PUT the whole cached settings row; a stale tab reverted anything changed elsewhere. Reproduced: setting a UPI ID elsewhere, then flipping Hide Profit, deleted it — which kills UPI collection entirely, since `buildUpiLink` returns null without a VPA. Now writes one field. Test confirmed to fail when the spread returns.
- **Hindi 32% → 79%** on the Account root: descriptions, group headings, page title, stat labels, completion checklist.
- **Page title vs row label mismatch** in Hindi.
- **Manage Shops** advertised "Add shops"; only Rename works. Honest description + SOON badge; Account menu can render badges now.

### Logged, not fixed 📋

| ID | Finding | Why deferred |
|---|---|---|
| A1 | Notification prefs, theme, language, dark mode are localStorage-only — reset on reinstall/new phone | Phase 4; needs schema + migration |
| A2 | Multi-shop add/switch not built; needs `shopId` stamped on every write and filtered on every read | Large; own project |
| A3 | Deeper Account pages ~11% translated in Hindi | Phase 2 |
| A4 | Feature Toggles: 21 switches, 3.3 screens, no grouping | Phase 3 |
| A5 | No search within Account | Phase 3 |
| A6 | `text-3xs` (~10px) used for real content | Phase 1 |
| A7 | Empty states have no next action | Phase 5 |

---

## Part 5 — What to do first

If only one phase happens: **Phase 1**. Everything else is decoration on an improvising shell, and Phases 3–7 get materially cheaper once the primitives exist.

Recommended order: **1 → 3 → 2 → 4 → 5 → 6 → 7**. Phase 3 before 2 because progressive disclosure reduces how many strings Phase 2 has to translate.
