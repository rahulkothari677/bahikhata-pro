/**
 * Terms of Service — EkBook / BahiKhata Pro
 *
 * Legal compliance: DPDP Act 2026 requires clear terms for apps handling
 * financial data. This page covers: usage terms, data ownership, liability
 * limitations, GST compliance disclaimer, and account termination.
 */

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-lg shadow-sm p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Service</h1>
        <p className="text-sm text-gray-500 mb-8">Last updated: July 2026</p>

        <div className="prose prose-sm max-w-none text-gray-700 space-y-6">
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Acceptance of Terms</h2>
            <p>By using EkBook ("the Service"), you agree to these Terms of Service. If you do not agree, please do not use the Service. EkBook is a digital ledger and GST compliance tool designed for Indian small businesses.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Description of Service</h2>
            <p>EkBook provides digital ledger management, GST invoice generation, GSTR filing data export, AI-powered bill scanning, and financial analytics. The Service is not a GST Suvidha Provider (GSP) and does not directly file returns with GSTN. Users are responsible for submitting generated data to the GST portal.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. User Accounts</h2>
            <p>You are responsible for maintaining the confidentiality of your account credentials. You must provide accurate information during registration. Account sharing is prohibited. The Service supports staff sub-accounts with configurable permissions; the account owner is responsible for all staff actions.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Data Ownership & Privacy</h2>
            <p>You own all financial data you enter into EkBook. We do not sell or share your data with third parties. Your data is stored securely on servers located in India. You can export your data at any time and delete your account to permanently remove all data. See our Privacy Policy for details.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. GST Compliance Disclaimer</h2>
            <p>EkBook generates GST-compliant invoice formats and GSTR data exports based on the information you provide. However, EkBook is not a substitute for professional tax advice. You are solely responsible for the accuracy of all GST filings. Always verify generated data before submitting to the GST portal. Consult a Chartered Accountant for complex tax situations.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Acceptable Use</h2>
            <p>You agree not to: (a) use the Service for illegal activities, (b) enter false or misleading financial data, (c) attempt to access other users' data, (d) reverse engineer the Service, or (e) use automated tools to overload the Service. Violations may result in account termination.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Subscription & Payments</h2>
            <p>EkBook offers Free, Pro, and Elite subscription tiers. Subscription fees are billed through Razorpay. Refunds are available within 7 days of payment if you have not used premium features. Prices may change with 30 days notice. Downgrading takes effect at the end of the current billing cycle.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Limitation of Liability</h2>
            <p>EkBook is provided "as is" without warranties of any kind. We are not liable for: (a) inaccurate GST filings based on incorrect data you entered, (b) business losses from decisions made using the Service, (c) data loss from circumstances beyond our control, or (d) service interruptions. Our total liability is limited to the amount you paid in the last 12 months.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Account Termination</h2>
            <p>You can delete your account at any time from Settings. Account deletion permanently removes all transactions, parties, products, and financial data. This action cannot be undone. We may terminate accounts that violate these Terms or remain inactive for 12+ months.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">10. Changes to Terms</h2>
            <p>We may update these Terms with 30 days notice. Continued use after changes constitutes acceptance. Material changes will be communicated via email and in-app notification.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">11. Contact</h2>
            <p>For questions about these Terms, contact: support@ekbook.app</p>
          </section>

          <div className="mt-8 pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-500">© 2026 EkBook. All rights reserved. EkBook is a product of BahiKhata Pro.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
