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
    // Navigation - simple, common Hindi words
    'nav.dashboard': 'डैशबोर्ड',
    'nav.scanner': 'AI बिल स्कैनर',
    'nav.sales': 'बिक्री',
    'nav.purchases': 'खरीद',
    'nav.inventory': 'स्टॉक',
    'nav.income': 'आय और खर्च',
    'nav.parties': 'ग्राहक',
    'nav.reports': 'रिपोर्ट',
    'nav.settings': 'सेटिंग्स',

    // Dashboard - simple words every shop owner uses
    'dash.greeting': 'नमस्ते',
    'dash.today_revenue': 'आज की बिक्री',
    'dash.today_profit': 'आज का मुनाफा',
    'dash.sales_today': 'आज की बिक्री',
    'dash.revenue': 'कुल बिक्री',
    'dash.net_profit': 'कुल मुनाफा',
    'dash.receivable': 'वसूल होना बाकी',
    'dash.payable': 'देना बाकी',
    'dash.stock_value': 'स्टॉक की कीमत',
    'dash.gst_payable': 'GST देना है',
    'dash.business_overview': 'व्यापार सारांश',
    'dash.filter_hint': 'तारीख से सभी चार्ट फिल्टर करें',
    'dash.sales_trend': 'बिक्री और मुनाफा',
    'dash.top_products': 'सबसे ज्यादा बिकने वाले सामान',
    'dash.payment_modes': 'पैसे कैसे मिले',
    'dash.category_breakdown': 'कैटेगरी से बिक्री',
    'dash.low_stock': 'स्टॉक खत्म हो रहा है',
    'dash.recent_transactions': 'हाल की एंट्री',
    'dash.gst_summary': 'GST सारांश',
    'dash.smart_insights': 'स्मार्ट सुझाव',
    'dash.view_all': 'सभी देखें',
    'dash.manage': 'देखें',
    'dash.full_report': 'पूरी रिपोर्ट',

    // Common
    'common.save': 'सेव करें',
    'common.cancel': 'रद्द करें',
    'common.delete': 'हटाएं',
    'common.edit': 'बदलें',
    'common.add': 'जोड़ें',
    'common.search': 'खोजें',
    'common.loading': 'लोड हो रहा है...',
    'common.no_data': 'कोई डेटा नहीं',
    'common.total': 'कुल',
    'common.profit': 'मुनाफा',
    'common.date': 'तारीख',
    'common.amount': 'रकम',
    'common.quantity': 'मात्रा',
    'common.price': 'दाम',

    // Actions
    'action.new_sale': 'नई बिक्री',
    'action.new_purchase': 'नई खरीद',
    'action.add_product': 'सामान जोड़ें',
    'action.add_party': 'ग्राहक जोड़ें',
    'action.scan_bill': 'बिल स्कैन करें',
    'action.sign_out': 'लॉग आउट',

    // Auth
    'auth.sign_in': 'लॉगिन',
    'auth.sign_up': 'नया खाता बनाएं',
    'auth.email': 'ईमेल',
    'auth.password': 'पासवर्ड',
    'auth.name': 'आपका नाम',
  },
}

export function getTranslation(lang: Language, key: string): string {
  return translations[lang]?.[key] || translations.en[key] || key
}
