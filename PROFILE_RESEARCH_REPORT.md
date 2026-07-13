# Top World Apps — Profile / Account / Settings Research

**Purpose:** Reference for building a premium ledger app for Indian shopkeepers.
**Scope:** 15 apps across fintech, social, media, e-commerce, productivity, and Indian fintech.
**Method:** Web search + page-reader extraction of official help centers and docs.

---

## EXECUTIVE SUMMARY (read this first)

After analyzing all 15 apps, six universal truths emerge:

1. **Profile entry point is almost always a single avatar/initial icon.** It sits either **top-right** (PayPal, Cash App, Venmo gear, Robinhood person icon, Spotify, Instagram hamburger) or **top-left** (Wise, WhatsApp, Notion workspace switcher, Linear workspace name). A bottom "Account" tab is rarer (Robinhood, Spotify, BharatPe) and usually pairs with a person icon.
2. **Profile pages are a vertical scroll-list of grouped sections**, NOT a grid and NOT tabs. Group headers separate Personal / Security / Payments / Preferences / Support / Legal. Each row is: **icon • label • optional subtitle/value • chevron**.
3. **A plan/upgrade card sits at the TOP of the profile** in every monetized app (Revolut, Spotify, Robinhood Gold, PayPal, Cash App). It's the single most effective premium surface.
4. **The 5 universal items** that appear in *every* app's profile: Account/Personal details, Security & privacy, Notifications, Help & support, Log out.
5. **Design trend is dark, minimal, high-contrast** (Linear, Robinhood, Cash App, Khatabook dark mode). Rounded corners 12–16px. Generous whitespace. Inter / SF Pro / system fonts. One accent color.
6. **Gamification + rewards + referrals** are core engagement levers in fintech (Revolut RevPoints, Cash App invite, PayPal rewards, BharatPe Charge & Earn, Khatabook reports) — every shopkeeper app should have at least one.

---

## 1. PAYPAL (Global Fintech)

### A. Profile / Account Section
PayPal's mobile **Settings** (gear icon, top-right) groups into:
- **Personal info** — legal name, email, phone, street address, language, date of birth
- **Payment methods / Wallet** — linked bank accounts, debit/credit cards, PayPal balance, PayPal Debit Card
- **Seller Profile** (toggle personal ↔ business) — manage seller info, switch profiles
- **Account Preferences** — time zone, language
- **Data & Privacy** — privacy preferences, permissions given to apps/sites, data download
- **Security** — 2-step verification, password, security questions
- **Notifications** — push/email/SMS toggles
- **Account settings** — close account, account type
- **Help / Resolution Center / Tax Center / Message Center**

**Layout:** Vertical grouped list, gray section headers, chevron rows. Web uses a left sidebar + main panel.

### B. Navigation Pattern
- **No bottom tab bar** on main wallet screen — primary actions (Home, Payments, Wallet, More) live in a bottom bar OR a top nav depending on version.
- Profile = **gear/avatar icon, top-right**.
- "More" handled via a hamburger (≡) or a dedicated More tab opening a sheet of secondary actions.

### C. Design Language
- **Color:** PayPal Blue (#003087 deep, #0070E0 action blue) on white. Clean, trustworthy, banking-conservative.
- **Typography:** Sans-serif (San Francisco / PayPal Sans), strong hierarchy, large balance numbers.
- **Cards:** Soft shadows, 12–16px radius, white cards on light-gray background.
- **Spacing:** Generous, breathing room between sections.
- **Unique elements:** Blue checkmark verification badges, PayPal wordmark, card-art illustrations.

### D. Premium / Adoptable Features
- **Rewards hub** (cashback, offers) — gamified shopping rewards.
- **Seller Profile switcher** — one tap personal ↔ business.
- **Permissions manager** — see which third-party apps have access.
- **Resolution Center** — in-app dispute/claim center.
- **Tax Center** — consolidated tax docs.
- **Message Center** — chat-style support inbox.

---

## 2. REVOLUT (European Fintech Super-App)

### A. Profile / Account Section
Revolut's **Profile** (tap avatar top-left → opens Hub) is the gold standard of grouped settings. Sections:
- **Personal details** — Revolut ID, name, address, phone, email, date of birth, Revtag (username), tax info, source of funds, ID verification
- **Login and security** — passcode, Face ID, passkeys, change phone number, lost device, login history
- **Cards** — order/customize cards (text, freehand drawing, pre-made designs on Plus/Premium/Metal), virtual cards, single-use cards, freeze/unfreeze, PIN, limits
- **Plans and benefits** — current plan + upgrade CTA (Standard/Plus/Premium/Metal/Ultra)
- **Accounts** — Pockets (sub-accounts), Joint, Professional, Savings, teen accounts
- **Documents** — account confirmation, statement of fees, transaction statements, Pockets statement, subject-access request
- **Settings** — notifications, **Hidden Balance** feature (hide balances on screen), **Gambling Block**, language switching
- **More help with my profile** — upload document, manage data, tax declaration
- **Close account**, **Contact Support** (in-app chat)

**Layout:** Grouped vertical list, each group titled; avatars at top showing plan tier color.

### B. Navigation Pattern
- **Bottom tabs (typically 4–5):** Home, Cards/Accounts, Payments/Transfer, Invest/Hub, Profile(Hub icon).
- Profile = **Hub icon, top-left** (avatar with plan-color ring).
- "More" = the Hub itself is the "more" — it aggregates all secondary features.

### C. Design Language
- **Color:** Deep near-black (#0D1117-ish) dark mode primary; plan tiers color-coded (Standard gray, Plus teal, Premium purple, Metal dark steel, Ultra gold/black).
- **Typography:** Inter / SF, bold large balances, tight line-height.
- **Cards:** Card "art" with gradient + plan color ring around avatar; 16px radius; subtle elevation.
- **Spacing:** Dense but clean; lots of grouped inset lists (iOS Settings style).
- **Unique elements:** **Color ring around avatar matching plan tier**, card customization canvas, RevPoints loyalty currency, Ultra gold accents.

### D. Premium / Adoptable Features
- **5-tier plan ladder** (Free → Plus → Premium → Metal → Ultra) with clear benefit comparison — gold standard for premium upsell.
- **Plan-colored ring around avatar** — subtle status signal.
- **Customizable card art** — personalization delight.
- **RevPoints** — spend-to-earn points redeemable for rewards (gamification).
- **Hidden Balance** — privacy feature for shopkeepers showing app to customers.
- **Gambling Block** — one-tap spending control.
- **Pockets** — sub-accounts/savings goals.
- **In-app document vault** — statements, tax, fee disclosures.
- **Teen/Kids accounts** — family onboarding.

---

## 3. WISE (International Money Transfer)

### A. Profile / Account Section
Wise keeps it **minimalist** (avatar top-left). Sections:
- **Personal details** — profile picture (camera icon), legal name (locked, requires support), **preferred name** (editable), date of birth, address, phone, email
- **Balance & currencies** — hold 50 currencies
- **Cards** — Wise debit card management
- **Privacy & Security** — discoverability (let others find you to send money), 2FA, password, devices
- **Notifications**
- **Documents** — statements, confirmations
- **Preferences** — language, currency display
- **Help / Contact**, **Log out**

**Layout:** Very clean iOS-Settings-style grouped list. Sparse, lots of whitespace. Many fields greyed out (locked for security — must contact support).

### B. Navigation Pattern
- **Bottom tabs:** Home, Send, Cards/Balance, Profile (or top-left avatar).
- Profile = **avatar/initials top-left**.
- Minimal "more" — everything fits in the profile.

### C. Design Language
- **Color:** Wise Green (#9FE870 bright, #163300 deep) on white / bright green accents. Bright, friendly, distinctive.
- **Typography:** Inter, large readable numbers, multilingual-friendly.
- **Cards:** Flat, thin borders, light shadows, 12px radius.
- **Spacing:** Generous, calm, uncluttered.
- **Unique elements:** Bright green brand, multi-currency switcher pills, "preferred name vs legal name" distinction.

### D. Premium / Adoptable Features
- **Discoverability toggle** — let others find your account to send you money (great for shopkeepers receiving payments).
- **Preferred name vs legal name** split — friendly display + verified legal.
- **Multi-currency balance** — 50 currency pockets.
- **Locked-by-default sensitive fields** — security-by-design pattern.
- **Transparent fee breakdown** — trust building.

---

## 4. ROBINHOOD (Investing)

### A. Profile / Account Section
**Account** (person icon) → **Profile**. Items:
- **Profile** — profile photo, username, **color theme**, year joined, total investing value (Investing / Retirement / Spending breakdowns)
- **Edit profile** (pencil) — photo, username, color theme
- **Profile visibility** — No one / Anyone on Robinhood (controls Pay & Request discoverability)
- **Account & Login** — info, security, new device, notifications
- **Investing** — brokerage holdings, cash, crypto
- **Retirement** — IRA (Roth/Traditional) holdings & cash, IRA Settings
- **Bank transfers & linking**
- **Robinhood Gold** (premium) — billing date, upgrade
- **Documents & taxes** — statements, 1099s, custom activity reports
- **Spending** (Cash Card), **Wallet** (crypto), **Banking**
- **Help**, **Log out**

**Layout:** Profile is a public-ish "card" with photo + theme color + stats; settings are a separate Account menu list.

### B. Navigation Pattern
- **Bottom tabs (5):** typically Home/Investing, Cash Card/Spending, Search, Notifications, Account (person icon).
- Profile = **person icon, bottom-right tab**.
- "More" = the Account tab is the catch-all.

### C. Design Language
- **Color:** Default **dark mode** (#000 black background), Robinhood Green (#00C805) accent, high contrast white text. Cash Card has signature green. Premium "Gold" uses gold accents.
- **Typography:** SF Pro / Inter, very large bold portfolio value, minimal labels.
- **Cards:** Flat, no shadows, thin dividers, mostly borderless.
- **Spacing:** Generous, charts dominate.
- **Unique elements:** **Color theme picker on profile** (personalization), green growth charts, Gold tier gold-accent badges, Legend advanced charting.

### D. Premium / Adoptable Features
- **Profile color theme** — personalization delight (low effort, high engagement).
- **Robinhood Gold** — premium subscription (higher interest, margin, Gold Card, Concierge).
- **Profile visibility toggle** — privacy control.
- **Account-value breakdown** by product line on profile header.
- **Multi-account** (brokerage + IRA + spending) under one login.

---

## 5. CASH APP (US Payments)

### A. Profile / Account Section
Tap **profile icon top-right** on home. Items (top to bottom):
- **Profile header** — avatar, name, $Cashtag
- **Invite Friends** (referral, prominent)
- **Personal Info** — legal name, SSN last 4, DOB, address
- **Privacy & Security** — Security Lock (PIN/Face ID), **Cash PIN reset**, Block & report
- **Increase Limits** — verification flow
- **Notifications** — push/email/SMS
- **Documents** — account statements, tax reporting
- **Bitcoin** — wallet, withdraw limits
- **Stocks / Investing**
- **Cash Card** — design, PIN, ATM, limits
- **Funds / Bank accounts**
- **Connected accounts**
- **Account settings** — close account
- **Support / Contact** (24/7 chat), **Legal**, **Log out**

**Layout:** Single vertical list with prominent **Invite Friends** card near top (green CTA). Mobbin-documented: account page shows profile info, invite friends, account & settings grouped.

### B. Navigation Pattern
- **Bottom tabs:** Home (and historically a left-rail on web with "Account at bottom of left toolbar").
- Profile = **avatar top-right** (or top-left in some versions).
- "More" = the profile page itself cascades everything.

### C. Design Language
- **Color:** **Cash Green** (#00D632) + black, signature minimalist. Light and dark modes.
- **Typography:** SF Pro, large, friendly.
- **Cards:** Flat, rounded 16px, green CTAs.
- **Spacing:** Generous, big tap targets.
- **Unique elements:** $Cashtag (memorable handle), green-on-black, simple iconography, Lightning Network for Bitcoin.

### D. Premium / Adoptable Features
- **Invite Friends referral** (top of profile) — viral growth engine.
- **Cash Card design studio** — custom card art.
- **Increase Limits** as an explicit action (not hidden).
- **Bitcoin + Stocks + Cash Card** all from one profile.
- **24/7 in-app chat support**.
- **Boosts** (instant cashback offers on Cash Card) — gamified rewards.

---

## 6. VENMO (US Social Payments)

### A. Profile / Account Section
**Me tab** (bottom-right) → **Settings gear** (top-right). Items:
- **Profile** — photo, name, username, business profile switcher
- **Privacy** — default (Public / Friends / Private), past transactions, Friends List visibility, Find Me by phone/email
- **Friends & Social** — friends list privacy, social feed preferences
- **Notifications** — push/email/SMS
- **Account & Settings** — change password, security, linked banks/cards
- **Business Profile** — edit photos, business username
- **Identity Verification**
- **Payment Methods**
- **Tax** — 1099-K, tax profile
- **Help**, **About**, **Log out**

**Layout:** Me tab is a social profile (photo, friends, transaction feed); Settings is a nested iOS-style list.

### B. Navigation Pattern
- **Bottom tabs:** typically Home/Feed, Search, Pay/Request (center action), Notifications, **Me** (bottom-right).
- Profile = **Me tab, bottom-right**; Settings = **gear, top-right inside Me**.
- "More" = hamburger (☰) in older versions, now the Me tab + gear.

### C. Design Language
- **Color:** Venmo Blue (#3D95CE) + white, friendly/social feel.
- **Typography:** SF Pro, casual.
- **Cards:** Rounded, social-feed style cards with avatars + emoji notes.
- **Spacing:** Feed-oriented, image-heavy.
- **Unique elements:** **Social transaction feed** (public payments with emoji memos), **QR code profiles**, business/personal profile switcher.

### D. Premium / Adoptable Features
- **Business Profile switcher** (personal ↔ business) — relevant for shopkeepers.
- **QR code profile** — scan to pay.
- **Social feed** for payments (engagement).
- **Privacy granularity** (per-transaction + default + past).
- **Friends List privacy** controls.

---

## 7. WHATSAPP (Messaging — Settings Pattern)

### A. Profile / Account Section
**More options (⋮) → Settings** (or bottom Settings tab on iOS). Sections:
- **Account** — privacy, security, two-step verification, change number, request account info, delete account
- **Chats** — theme, wallpaper, chat history, media visibility, font size, enter-to-send
- **Notifications** — message/group/call tones, vibration, pop-up, high-priority
- **Storage and Data** — manage storage, network usage, media auto-download
- **App Language**
- **Help** — contact us, FAQ
- **Privacy** (now top-level): Last seen & online, Profile photo, About, Status, Groups, Read receipts, Disappearing messages default, Silence unknown callers, Live location, Blocked contacts, **Privacy Checkup**
- **Avatar**
- **Linked Devices**
- **Profile** — name, about, photo

**Privacy granularity (recurring 4-option pattern):** Everyone / My Contacts / My Contacts Except… / Nobody.

**Layout:** iOS-Settings-style grouped list, the canonical "5 categories: Account, Chats, Notifications, Storage/Data, Help" (per WikiHow).

### B. Navigation Pattern
- **Bottom tabs (iOS):** Chats, Status, Calls, Settings (or top tabs on Android with Settings behind ⋮).
- Profile = inside Settings (no separate profile tab); **bottom Settings tab on iOS**.
- "More" = ⋮ overflow menu.

### C. Design Language
- **Color:** WhatsApp Green (#25D366 bright, #075E54 deep) + light/dark; green chat bubbles.
- **Typography:** Helvetica/SF, system fonts, readable.
- **Cards:** Flat list rows, no cards, thin dividers — maximum information density.
- **Spacing:** Tight, list-dense.
- **Unique elements:** **4-level privacy selector pattern**, **Privacy Checkup** wizard, green checkmarks (sent/delivered/read), QR code, multi-account switching.

### D. Premium / Adoptable Features
- **Privacy Checkup** wizard — guided security review (huge trust + engagement).
- **4-level privacy selector** (Everyone / Contacts / Except / Nobody) — copy this for customer data visibility.
- **Two-step verification** + change number flow.
- **Linked Devices** management.
- **Multi-account** switching in one app.
- **Custom Lists** for chat filtering.

---

## 8. INSTAGRAM (Social — Profile/Account Pattern)

### A. Profile / Account Section
**Profile** (bottom-right) → **Hamburger (☰) top-right** → **Settings and Account Center**. Items:
- **Accounts Center** (Meta-wide: profile, posting, preferences, password & security, personal details)
- **Follow and invite friends**
- **Saved**
- **Close friends**
- **Favorites and following**
- **Supervision** (family controls)
- **QR code**
- **Notifications** — push, email, SMS
- **Time management** — daily limit, reminder, sleep mode
- **Account status** (community guideline compliance)
- **Sensitive content control**
- **Ads** preferences
- **Security** — login activity, two-factor, emails from Instagram
- **Privacy** — account privacy (private toggle), account activity, hidden words, blocked, restricted, story, live, messages, mentions, tags, comments, contacts
- **Help** — Help Center, report problem, privacy & security help
- **About**, **Your activity**, **Archive**, **Your activity off Meta technologies**, **Logout**

**Layout:** Profile is a rich grid (posts/reels/tagged tabs); settings are a long nested iOS-style list with search.

### B. Navigation Pattern
- **Bottom tabs:** Home, Search, Reels (center, prominent), Shop, **Profile (bottom-right)**.
- Profile = **bottom-right tab**; Settings = **☰ top-right inside Profile**.
- "More" = hamburger opens sheet with search + list.

### C. Design Language
- **Color:** White/black minimal + **Instagram gradient** (purple-pink-orange-yellow) for story rings & logo; clean light/dark.
- **Typography:** SF Pro, bold usernames, small captions.
- **Cards:** Edge-to-edge images, story rings, circular avatars.
- **Spacing:** Tight, image-first.
- **Unique elements:** **Gradient story rings**, profile stats row (posts/followers/following), highlights circles, verified blue badge, Profession/Category labels.

### D. Premium / Adoptable Features
- **Gradient story ring** — signature status/badge visual.
- **Profile stats row** — at-a-glance metrics.
- **Search at top of settings** — essential when settings list is long.
- **Account status compliance** indicator.
- **Accounts Center** — manage multiple Meta products from one place (multi-business).
- **Hidden words / restricted / blocked** granular control.
- **Professional dashboard** for creator/business accounts.

---

## 9. SPOTIFY (Media — Account/Settings Pattern)

### A. Profile / Account Section
Tap **profile picture (top)** → **View profile**; and **Settings and privacy** (gear). Items:
- **Profile** — display name, profile picture, public playlists, recently played artists, following, followers
- **Account** — email, gender, DOB, country/region, password, log out everywhere
- **Manage payments** — payment methods, plan, receipts, billing date
- **Plan settings** — Premium Individual / Student / Duo / Family / Kids; change/cancel
- **Privacy & social** — recently played, followers, listening activity, private session
- **Notifications** — push/email, music, podcasts, recommendations
- **Devices** — Spotify Connect, local device visibility, offline devices
- **Playback** — crossfade, gapless, normalize, audio quality, equalizer
- **Storage** — offline downloads, delete cache
- **Language**
- **Security** — protect account, verify email, "is this email legit?"
- **Explicit content** toggle
- **Help / Contact us**, **About**

**Layout:** Settings is a long grouped list; Profile is a card with playlists.

### B. Navigation Pattern
- **Bottom tabs:** Home, Search, Your Library; **profile picture top-right** (opens menu: Profile, Settings).
- "More" = profile-picture dropdown menu (Profile, Settings, Private Session, Log out).

### C. Design Language
- **Color:** **Spotify Green (#1DB954)** on **near-black (#121212)** dark mode default — the canonical music-app dark aesthetic.
- **Typography:** Circular / Spotify font, bold headers, large play buttons.
- **Cards:** Rounded 8–12px, dark gray (#282828) cards on black, subtle gradients.
- **Spacing:** Generous, image-led.
- **Unique elements:** **Now Playing bar** persistent at bottom, green active states, playlist cover gradients, Premium badges.

### D. Premium / Adoptable Features
- **Plan ladder** (Free / Individual / Student / Duo / Family) — clear tiered upsell.
- **Private Session** toggle (one-tap incognito).
- **Listening activity / recently played** privacy controls.
- **Spotify Connect** (device handoff).
- **Family/Duo plan** with shared management.
- **Playback quality & crossfade** — power-user preferences.
- **Listening stats / Wrapped** (annual gamified recap).

---

## 10. AMAZON (E-commerce — Account Section)

### A. Profile / Account Section
**"Your Account"** (bottom nav / hamburger) is a LONG categorized list. Top categories:
- **Your Orders** (filter by date/status), **Buy Again**, **Keep Shopping For**, **Your Lists**
- **Your Addresses**
- **Your Payments** — add/manage cards, bank, default payment, backup payment, gift card balance
- **Gift Cards & Registry** — balance, reload, redeem
- **Your Prime** — membership, benefits, manage
- **Login & Security** — name, email, mobile, password, 2FA
- **Your Messages**
- **Your Subscriptions** (Subscribe & Save)
- **Amazon Pay** — account activity
- **Your Content and Devices** (Kindle, digital)
- **Memberships & Subscriptions**
- **Switch Accounts / Manage Profiles** (up to 5 shopping profiles)
- **Browsing History**, **Your Returns**, **Your Recommendations**
- **Help & Customer Service**, **Your Amazon Profile (public)**

**Layout:** Categorized grid-of-cards on mobile (each category is a tappable card), grouped list on web. Dense.

### B. Navigation Pattern
- **Bottom tabs (mobile):** Home, Departments/Browse, Notifications, **You (bottom-right, person icon)**.
- Profile/Account = **"You" tab bottom-right**.
- "More" = hamburger (≡) top-left for departments.

### C. Design Language
- **Color:** Amazon Orange (#FF9900) + navy (#232F3E) + white. Functional, dense.
- **Typography:** Amazon Ember, small sizes, dense info.
- **Cards:** Square-ish, bordered list rows, small radii (4–8px).
- **Spacing:** Tight, info-dense, transactional.
- **Unique elements:** Prime badge, star ratings, "Buy Again" loop, multi-profile households.

### D. Premium / Adoptable Features
- **Multi-profile / Switch Accounts** — one login, multiple shop/business profiles.
- **Buy Again / Reorder** — repeat-purchase shortcut (analog: repeat transaction).
- **Gift card balance & reload** — store credit.
- **Subscribe & Save** recurring management.
- **Returns center** self-service.
- **Recommendations** personalization.
- **Help hub** with order-contextual support.

---

## 11. NOTION (Productivity — Settings Pattern)

### A. Profile / Account Section
**Sidebar → workspace name dropdown → Settings → {your name} / Preferences**. Items:
- **Profile** — profile photo, preferred name, email
- **Preferences / Account** — appearance (Light/Dark/System), font size, page width, full-width toggle
- **My connections** (OAuth apps)
- **My plan** (Free / Plus / Business / Enterprise) + billing
- **Members & billing**
- **Notifications** — email, mobile, mention behavior
- **Language & region**
- **Workspace settings** — name, icon, plan, security, export, delete
- **Connections / Integrations**
- **Log out**

**Layout:** Settings is a **modal overlay** with left sub-nav (Account, Preferences, Members, Billing, Connections, Security) and right content. Mobile: opens via ••• → Settings, grouped sections.

### B. Navigation Pattern
- **No bottom tabs** — sidebar navigation (collapsible).
- Profile = **workspace switcher (top-left)** with avatar; settings inside it.
- "More" = sidebar itself; everything navigable.

### C. Design Language
- **Color:** Notion neutrals — off-white (#FFFFFF / #F7F7F5) light, near-black dark mode; subtle accent colors per block.
- **Typography:** Custom sans + serif + mono options; clean, editorial.
- **Cards:** Block-based, thin borders, 3–6px radius, minimal shadows.
- **Spacing:** Generous, document-like.
- **Unique elements:** Block-level customization, page icons/covers, light/dark/system theme toggle.

### D. Premium / Adoptable Features
- **Workspace switcher** (multiple workspaces/businesses).
- **Appearance: Light / Dark / System** — universal expectation now.
- **Page-level customization** (icons, covers).
- **Plan ladder** with member-based billing.
- **Connections/integrations** marketplace.
- **Notification granularity** per-mention.

---

## 12. LINEAR (Productivity — Clean Design)

### A. Profile / Account Section
**Workspace name → Settings** opens a **"settings homepage"** (Linear deliberately designed settings as a feature, not a failure). Left sub-nav:
- **Preferences** — default home view, display full names, first day of week, convert emoticons→emoji, **interface & theme (70+ themes + custom)**, desktop app (open URLs, notification badges, spell check), automations (auto-assign to self, auto-assign on move-to-started)
- **Profile** — name, username, photo, status, timezone
- **Notifications** — per-event email/in-app, schedule
- **Code & reviews** — git attachment format, branch-copy behavior
- **Security & access** — sessions, 2FA, API keys, password
- **Account** — email, plan, billing, delete

**Layout:** Settings homepage shows cards for each section with inline tips/tutorials — **settings doubles as product education**.

### B. Navigation Pattern
- **Left sidebar navigation** (no bottom tabs — desktop-first); **Cmd+K** command palette.
- Profile = **workspace name top-left** → Settings.
- "More" = sidebar + command palette + ⌘K.

### C. Design Language
- **Color:** **Primary #5e6ad2 (Linear purple/indigo)**; dark by default (#08090a Void, #0f1011 Carbon — pure black with faint blue tint); chrome intentionally minimal.
- **Typography:** **Inter Variable** for UI, **Berkeley Mono** for code; tight, precise.
- **Cards:** **9999px (pill) / sharp** corners; flat; no shadows; thin 1px borders.
- **Spacing:** Precise, minimal, dense-but-airy.
- **Unique elements:** **70+ themes on linear.style**, ⌘K command bar, settings-as-education, near-black canvas, purple accent everywhere.

### D. Premium / Adoptable Features (the design north star)
- **Settings-as-homepage with tips/tutorials** — onboarding + customization combined.
- **70+ themes + custom theme builder** — extreme personalization.
- **Default home view picker** — let user choose their landing screen.
- **⌘K / command palette** — power-user speed.
- **Minimal chrome, maximum content** philosophy.
- **Theme sharing** (linear.style open-source).
- **Auto-assign automations** in preferences.

*Linear's own blog: "Settings are not a design failure. Users love settings… they make them feel at home."*

---

## 13. RAZORPAY (Indian Fintech)

### A. Profile / Account Section
Dashboard **Account & Settings** (web-first, also app). Sections:
- **Configure Your Profile** — registered phone number, login email, password, **2-Step Verification** (OTP to mobile + account password)
- **Account Details** — business legal name, PAN, GST, address
- **Website & App Settings** — business website/app details, **API keys (generate/regenerate)**, webhook URLs
- **Business Settings** — business profile, brand, settlement profile
- **Payments & Refunds** — payment methods, refund policy, enabled modes
- **Bank Account & Settlements** — settlement account, schedule
- **Team Members & Roles** — multi-user with permissions
- **Reports** — statements, exports
- **Switch Merchant** (multi-account), **Contact Support**, **FAQs**

**Layout:** Web = left sidebar with Account & Settings as a sub-section; mobile = grouped list with edit-pencil rows.

### B. Navigation Pattern
- Web dashboard sidebar; mobile = bottom tabs (Payments, Settlements, Profile) with profile behind avatar.
- "More" = sidebar overflow.

### C. Design Language
- **Color:** Razorpay Blue (#0C2451 navy + #3395FF bright) + white; professional Indian-fintech.
- **Typography:** Inter / system, dense data tables.
- **Cards:** Bordered panels, 4–8px radius, table-heavy.
- **Spacing:** Moderate, data-dense.
- **Unique elements:** Test/Live mode toggle, API key manager, multi-merchant switcher, 2-step verification gate.

### D. Premium / Adoptable Features
- **Multi-merchant switcher** (manage multiple shops).
- **API keys & webhooks** for advanced users.
- **2-Step Verification** mandatory for sensitive changes.
- **Team members & roles** — staff permissions.
- **Test/Live mode** toggle.
- **Settlement scheduling**.

---

## 14. BHARATPE (Indian Merchant Payments)

### A. Profile / Account Section
BharatPe **for Business** app profile (typically behind avatar/profile tab):
- **Shop/Business details** — store name, address, category, GST, PAN
- **BharatPe QR** — your QR code (download/print)
- **Settlements** — bank account, on-demand settlement, settlement history
- **Loans** — merchant loan offers, application status, repayment (post-merchant-credit)
- **Charge & Earn** — recharge/bill-pay commissions (extra income)
- **Manage Agents / Staff** — add store supervisor/agents
- **Notifications**
- **Reports / Passbook**
- **Profile / KYC** — verification status
- **Help / Support**, **Settings**, **Log out**

**Layout:** Home-centric with big balance + settlement card; profile is a grouped list.

### B. Navigation Pattern
- **Bottom tabs:** Home (payments), Settlements/Passbook, Loans/More, **Profile**.
- Profile = bottom tab (avatar).
- "More" = a More tab aggregating loans, recharge, reports.

### C. Design Language
- **Color:** BharatPe Yellow/Green on white; bright, mass-market India.
- **Typography:** Hindi/English bilingual, large tap targets (low-literacy friendly).
- **Cards:** Big colored cards, 12–16px radius, clear CTAs in Hindi+English.
- **Spacing:** Generous, button-first.
- **Unique elements:** Dual-language labels, big QR card, "Charge & Earn" income tile, agent/staff management.

### D. Premium / Adoptable Features
- **QR code as a first-class profile item** (download/print).
- **On-demand settlement** control.
- **Charge & Earn** (commissions on recharges) — extra-income gamification.
- **Merchant loans** from inside the app.
- **Manage agents/staff** — multi-user for a shop.
- **Bilingual everywhere** (Hindi + English + regional).

---

## 15. KHATABOOK (Indian Ledger — Direct Competitor)

### A. Profile / Account Section
Khatabook profile (avatar, typically top-left or a Profile tab):
- **Business/Shop name** + profile photo
- **Settings** — **Language (11 languages)**, app theme
- **Backup** — **automatic cloud backup** (when online), manual backup, restore
- **Business Reports** — summary, profit/loss, customer-wise
- **Payment Reminders** — auto SMS/WhatsApp reminders to customers
- **WhatsApp Share** — share bill/statement
- **Inventory / Stock** management
- **Business Loans** — apply + track application
- **Gold Rate / Money Management / Calculators** (content tools)
- **Notifications**
- **Help / Contact**, **Rate us**, **Share app**, **Log out**

**Layout:** Home = big "Add Entry" + customer list; profile = grouped list with prominent Backup + Reports + Reminders.

### B. Navigation Pattern
- **Bottom tabs:** Home/Khata, Reports, (More), Profile.
- Profile = avatar/profile tab.
- "More" = overflow for tools (loans, calculators, gold rate).

### C. Design Language
- **Color:** Khatabook Green/teal on white; **dark mode available**; bright, regional-Indian friendly.
- **Typography:** Multilingual (11 languages), large, low-literacy friendly.
- **Cards:** Colored entry cards (green = credit/jama, red = debit/udhaar), 12px radius.
- **Spacing:** Generous, button-first.
- **Unique elements:** **Green-credit/red-debit color coding**, **WhatsApp share** of statements, **auto-reminder** to customers, **automatic backup**, 11-language support.

### D. Premium / Adoptable Features (your direct benchmark — must match or beat)
- **Automatic cloud backup** + manual backup/restore (trust critical for shopkeepers).
- **11-language support** including Hinglish.
- **Payment reminders via WhatsApp/SMS** to customers (core USP).
- **WhatsApp bill/statement share**.
- **Business reports** (P&L, customer-wise).
- **Inventory/stock** module.
- **Business loans** marketplace.
- **Green/red color-coded entries** (jama/udhaar).
- **Calculators + Gold Rate** content tools (engagement + retention).

---

# E. COMMON PATTERNS ACROSS ALL 15 APPS

## E1. The Universal Profile Item Set (appears in ALL apps)
1. **Profile header** — avatar + name + (handle/username/store name) + optional status/plan badge
2. **Account / Personal details** — name, phone, email, address, DOB
3. **Security & Privacy** — PIN/passcode, biometric, 2FA, password, blocked/hidden
4. **Notifications** — push/email/SMS toggles
5. **Payments / Bank / Wallet** (fintech) or **Plan / Subscription** (SaaS)
6. **Documents / Reports / Statements**
7. **Help & Support** — FAQ, contact, chat
8. **Log out / Sign out**

## E2. The Standard Grouping Pattern (top → bottom)
1. **Plan / Upgrade card** (monetized apps) — top, prominent, colored
2. **Identity** — profile photo, name, username/handle
3. **Personal details** — contact info, business info, KYC
4. **Security & Privacy** — passcode, biometric, 2FA, visibility
5. **Money / Payments** — bank, cards, settlement, limits
6. **Preferences** — language, theme, appearance, notifications, playback/defaults
7. **Documents & Reports** — statements, tax, exports
8. **Support & Legal** — help, contact, terms, privacy
9. **Account actions** — switch profile, log out, delete account

## E3. Universal Design Elements
| Element | Standard |
|---|---|
| **Layout** | Vertical scroll grouped list (iOS-Settings style) |
| **Row anatomy** | Icon • Label • value/subtitle • chevron › |
| **Section headers** | Small, gray, ALL-CAPS or title-case |
| **Avatar** | Circular, with optional **plan-color ring** (Revolut) or **gradient ring** (Instagram) |
| **Rounded corners** | 12–16px cards, full-pill buttons |
| **Accent color** | Single brand color (green = Cash/Khatabook/WhatsApp/Spotify; blue = PayPal/Wise/Venmo; purple = Linear; navy = Razorpay) |
| **Dark mode** | Default or available in ALL modern apps; Linear/Robinhood/Spotify ship dark-first |
| **Typography** | Inter / SF Pro / system; large primary numbers, small labels |
| **Settings search** | Instagram, Linear, Notion add a search bar atop long settings |
| **Cards over tables** | Mobile uses cards; web uses tables/sidebars |

## E4. The "More" Section — Three Solutions
1. **Profile IS the More section** (Cash App, Robinhood, Wise) — profile page cascades everything.
2. **Dedicated More/Hub tab** (Revolut Hub, BharatPe, older WhatsApp ⋮) — aggregator tab.
3. **Hamburger menu** (Instagram ☰, Venmo ☰, Amazon ≡) — top-right or top-left sheet.

## E5. Premium / Upsell Surface Patterns
- **Plan card at TOP of profile** with tier ladder (Revolut 5-tier, Spotify 5-tier, Robinhood Gold, PayPal).
- **Color ring on avatar** matching plan tier (Revolut).
- **"Upgrade" CTA banner** (Spotify Premium bar, Cash App Boosts, Khatabook loans).
- **Benefit comparison** page (Revolut, Spotify).
- **Annual recap** gamification (Spotify Wrapped) — engagement + retention.

## E6. Gamification / Engagement Levers
- **Referral / Invite Friends** (Cash App top of profile, PayPal, Venmo, Khatabook share-app).
- **Loyalty points** (Revolut RevPoints).
- **Rewards/cashback** (PayPal Rewards, Cash App Boosts, BharatPe Charge & Earn).
- **Reports & stats** (Khatabook business reports, Spotify Wrapped, Robinhood portfolio).
- **Streaks / badges** (Instagram verified badge, Revolut plan badges).

## E7. Shopkeeper-App-Specific Must-Haves (synthesized from Khatabook + BharatPe + Razorpay)
1. **Multi-language** (≥11 Indian languages + Hinglish) — Khatabook benchmark.
2. **Automatic + manual backup** to cloud — non-negotiable trust.
3. **WhatsApp/SMS payment reminders** to customers — core USP.
4. **WhatsApp share of bills/statements** — viral distribution.
5. **Green-credit / red-debit color coding** — instant comprehension.
6. **QR code** as a profile surface (download/print) — BharatPe.
7. **Multi-shop / multi-merchant switcher** — Razorpay + Amazon.
8. **Staff/agent management** with roles — BharatPe + Razorpay.
9. **Business reports** (P&L, customer-wise, daily/monthly) — Khatabook.
10. **Business loans marketplace** — Khatabook + BharatPe.
11. **Inventory/stock** module — Khatabook.
12. **KYC + 2-step verification** on sensitive changes — Razorpay.

---

# F. RECOMMENDED PROFILE STRUCTURE FOR YOUR PREMIUM LEDGER APP

Synthesizing all 15 apps into one shopkeeper-grade design:

```
┌─────────────────────────────────────────┐
│  [Plan/Upgrade Card — premium upsell]   │  ← Revolut/Spotify style, top
│   "Go Pro — unlock reports & reminders" │
├─────────────────────────────────────────┤
│  👤 Avatar (with plan-color ring)        │  ← Revolut ring pattern
│     Shop Name                            │
│     @username · Owner name · ⭐ Pro       │
│     [Edit Profile]                       │
├─────────────────────────────────────────┤
│  ⚡ Quick stats row                       │  ← Robinhood/Instagram stats
│  Total Udhaar · This Month · Customers   │
├─────────────────────────────────────────┤
│  🏪 MY BUSINESS                          │
│   • Shop details (name, address, GST)    │
│   • QR Code (download/print)             │  ← BharatPe
│   • Switch Shop / Add new shop           │  ← Razorpay/Amazon multi-profile
│   • Staff & Agents (roles)               │  ← BharatPe/Razorpay
├─────────────────────────────────────────┤
│  💰 MONEY                                │
│   • Bank account & settlement            │
│   • Business loans                       │  ← Khatabook/BharatPe
│   • Reports & statements (P&L)           │
├─────────────────────────────────────────┤
│  🔔 ENGAGE                               │
│   • Payment reminders (WhatsApp/SMS)     │  ← Khatabook USP
│   • Share statement on WhatsApp          │
│   • Invite friends (referral)            │  ← Cash App
│   • Rewards / Cashback (Charge & Earn)   │  ← BharatPe
├─────────────────────────────────────────┤
│  🔒 SECURITY & PRIVACY                   │
│   • App lock (PIN/Face ID)               │
│   • Hidden balance (show-to-customer)    │  ← Revolut
│   • Two-step verification                │  ← Razorpay
│   • Privacy Checkup wizard               │  ← WhatsApp
│   • Blocked customers                    │
├─────────────────────────────────────────┤
│  ⚙️ PREFERENCES                          │
│   • Language (11 + Hinglish)             │  ← Khatabook
│   • Appearance (Light/Dark/System)       │  ← Notion/Linear
│   • Theme color picker                   │  ← Robinhood/Linear
│   • Notifications                        │
│   • Default home view                    │  ← Linear
├─────────────────────────────────────────┤
│  📦 DATA                                 │
│   • Backup & Restore (auto + manual)     │  ← Khatabook critical
│   • Export data                          │
│   • Inventory / Stock settings           │
├─────────────────────────────────────────┤
│  ❓ HELP & LEGAL                         │
│   • Help Center · Contact · Chat         │
│   • Terms · Privacy                      │
│   • Rate us · About                      │
│   • Log out                              │
└─────────────────────────────────────────┘
   🔍 Search settings (top, sticky)          ← Instagram/Linear/Notion
```

**Design tokens to adopt:**
- Accent: a single brand color (suggest **trust-green or indigo** for ledger).
- Dark mode default-optional, Light/Dark/System toggle.
- Inter (UI) + Berkeley/mono for amounts.
- 12–16px card radius, 8–12px button radius.
- Plan-color ring around avatar (free=gray, Pro=green/gold).
- ⌘K / quick-action search bar at top of profile.
- Settings-as-education tips inline (Linear pattern).

---

# G. SOURCES CONSULTED (official help centers / docs)
- PayPal: paypal.com/cshelp (account info, data & privacy, seller profile)
- Revolut: help.revolut.com/help/profile-and-plan (full profile topic tree + 5-tier plans)
- Wise: wise.com/help (personal details, discoverability, privacy & security)
- Robinhood: robinhood.com/us/en/support/articles/profile (profile, visibility, Gold)
- Cash App: cash.app/help/1015-account-settings (account settings, Mobbin screen)
- Venmo: help.venmo.com (general account settings, privacy, notifications, Me tab)
- WhatsApp: faq.whatsapp.com (privacy settings, 4-level selector, Privacy Checkup)
- Instagram: help.instagram.com (account settings, privacy, security, Accounts Center)
- Spotify: support.spotify.com (profile, plan settings, payments, privacy & social)
- Amazon: amazon.com/gp/help (Your Account, payments, addresses, profiles)
- Notion: notion.com/help/account-settings (profile, preferences, appearance)
- Linear: linear.app/docs/account-preferences + linear.app/blog/settings-are-not-a-design-failure + design system (#5e6ad2, Inter, 70+ themes)
- Razorpay: razorpay.com/docs/payments/dashboard/account-settings (profile, 2SV, API keys, multi-merchant)
- BharatPe: bharatpe.com + app store listings (QR, settlements, loans, Charge & Earn, agents)
- Khatabook: khatabook.com/blog/khatabook-app-features + app store (11 languages, backup, reports, reminders, loans)

All findings above are extracted/synthesized from these primary sources via web search + page-reader tools.
