// Lightweight i18n system for BahiKhata Pro
// Supports: English (en), Hindi (hi)

export type Language = 'en' | 'hi'

export const translations = {
  en: {
    // Navigation
    'nav.dashboard': 'Dashboard',
    'nav.scanner': 'AI Bill Scanner',
    'nav.sales': 'Sales Ledger',
    'nav.purchases': 'Purchase Ledger',
    'nav.inventory': 'Inventory',
    'nav.income': 'Income & Expense',
    'nav.parties': 'Parties',
    'nav.reports': 'Reports',
    'nav.settings': 'Settings',

    // Dashboard
    'dash.greeting': 'Namaste',
    'dash.today_revenue': "Today's Revenue",
    'dash.today_profit': "Today's Profit",
    'dash.sales_today': 'sales today',
    'dash.revenue': 'Revenue',
    'dash.net_profit': 'Net Profit',
    'dash.receivable': 'Receivable',
    'dash.payable': 'Payable',
    'dash.stock_value': 'Stock Value',
    'dash.gst_payable': 'GST Payable',
    'dash.business_overview': 'Business Overview',
    'dash.filter_hint': 'Filter all charts and stats by date range',
    'dash.sales_trend': 'Sales & Profit Trend',
    'dash.top_products': 'Top Selling Products',
    'dash.payment_modes': 'Payment Modes',
    'dash.category_breakdown': 'Sales by Category',
    'dash.low_stock': 'Low Stock Alerts',
    'dash.recent_transactions': 'Recent Transactions',
    'dash.gst_summary': 'GST Summary',
    'dash.smart_insights': 'Smart Insights',
    'dash.view_all': 'View all',
    'dash.manage': 'Manage',
    'dash.full_report': 'Full report',

    // Common
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.add': 'Add',
    'common.search': 'Search',
    'common.loading': 'Loading...',
    'common.no_data': 'No data',
    'common.total': 'Total',
    'common.profit': 'Profit',
    'common.date': 'Date',
    'common.amount': 'Amount',
    'common.quantity': 'Qty',
    'common.price': 'Price',

    // Actions
    'action.new_sale': 'New Sale',
    'action.new_purchase': 'New Purchase',
    'action.add_product': 'Add Product',
    'action.add_party': 'Add Party',
    'action.scan_bill': 'Scan Bill',
    'action.sign_out': 'Sign out',

    // Auth
    'auth.sign_in': 'Sign In',
    'auth.sign_up': 'Create Account',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.name': 'Your Name',
  },
  hi: {
    // Navigation
    'nav.dashboard': 'डैशबोर्ड',
    'nav.scanner': 'AI बिल स्कैनर',
    'nav.sales': 'बिक्री बही',
    'nav.purchases': 'खरीद बही',
    'nav.inventory': 'इन्वेंटरी',
    'nav.income': 'आय और खर्च',
    'nav.parties': 'ग्राहक और आपूर्तिकर्ता',
    'nav.reports': 'रिपोर्ट',
    'nav.settings': 'सेटिंग्स',

    // Dashboard
    'dash.greeting': 'नमस्ते',
    'dash.today_revenue': 'आज की आय',
    'dash.today_profit': 'आज का मुनाफा',
    'dash.sales_today': 'आज की बिक्री',
    'dash.revenue': 'आय',
    'dash.net_profit': 'शुद्ध मुनाफा',
    'dash.receivable': 'वसूली के बाकी',
    'dash.payable': 'चुकाने के बाकी',
    'dash.stock_value': 'स्टॉक की कीमत',
    'dash.gst_payable': 'GST देय',
    'dash.business_overview': 'व्यापार सिंहावलोकन',
    'dash.filter_hint': 'तारीख के अनुसार सभी चार्ट और आँकड़े फ़िल्टर करें',
    'dash.sales_trend': 'बिक्री और मुनाफा रुझान',
    'dash.top_products': 'सबसे ज्यादा बिकने वाले उत्पाद',
    'dash.payment_modes': 'भुगतान के तरीके',
    'dash.category_breakdown': 'श्रेणी के अनुसार बिक्री',
    'dash.low_stock': 'कम स्टॉक अलर्ट',
    'dash.recent_transactions': 'हाल के लेनदेन',
    'dash.gst_summary': 'GST सारांश',
    'dash.smart_insights': 'स्मार्ट अंतर्दृष्टि',
    'dash.view_all': 'सभी देखें',
    'dash.manage': 'प्रबंधित करें',
    'dash.full_report': 'पूरी रिपोर्ट',

    // Common
    'common.save': 'सहेजें',
    'common.cancel': 'रद्द करें',
    'common.delete': 'हटाएं',
    'common.edit': 'संपादित करें',
    'common.add': 'जोड़ें',
    'common.search': 'खोजें',
    'common.loading': 'लोड हो रहा है...',
    'common.no_data': 'कोई डेटा नहीं',
    'common.total': 'कुल',
    'common.profit': 'मुनाफा',
    'common.date': 'तारीख',
    'common.amount': 'राशि',
    'common.quantity': 'मात्रा',
    'common.price': 'मूल्य',

    // Actions
    'action.new_sale': 'नई बिक्री',
    'action.new_purchase': 'नई खरीद',
    'action.add_product': 'उत्पाद जोड़ें',
    'action.add_party': 'पार्टी जोड़ें',
    'action.scan_bill': 'बिल स्कैन करें',
    'action.sign_out': 'साइन आउट',

    // Auth
    'auth.sign_in': 'साइन इन',
    'auth.sign_up': 'खाता बनाएं',
    'auth.email': 'ईमेल',
    'auth.password': 'पासवर्ड',
    'auth.name': 'आपका नाम',
  },
}

export function getTranslation(lang: Language, key: string): string {
  return translations[lang]?.[key] || translations.en[key] || key
}
