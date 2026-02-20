export default function HelpPage() {
  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Help</h1>

      <section className="border rounded p-4 bg-gray-50 space-y-2">
        <h2 className="font-semibold">How to sign up (new users)</h2>
        <ol className="list-decimal ml-5 space-y-1 text-sm">
          <li>Enter your email and a password (6+ characters).</li>
          <li>Click <b>Sign up</b>.</li>
          <li>If asked, confirm your email via the confirmation message.</li>
          <li>Return and click <b>Sign in</b>.</li>
        </ol>
      </section>

      <section className="border rounded p-4 bg-gray-50 space-y-2">
        <h2 className="font-semibold">How to sign in (existing users)</h2>
        <ol className="list-decimal ml-5 space-y-1 text-sm">
          <li>Enter your email and password.</li>
          <li>Click <b>Sign in</b>.</li>
          <li>Use the top navigation to access Dashboard, Bets, Reports, Assistant.</li>
        </ol>
      </section>

      <section className="border rounded p-4 bg-gray-50 space-y-2">
        <h2 className="font-semibold">Where features live</h2>
        <ul className="list-disc ml-5 space-y-1 text-sm">
          <li><b>Dashboard</b>: stats + performance summaries.</li>
          <li><b>Bets</b>: add bets, edit, grade (OPEN/FINAL), filters, export filtered CSV.</li>
          <li><b>Reports</b>: one-click exports (All, Open, Final) + CSV preview.</li>
          <li><b>Assistant</b>: “smart” Q&A over your ledger (no API key required yet).</li>
        </ul>
      </section>

      <section className="border rounded p-4 bg-gray-50 space-y-2">
        <h2 className="font-semibold">Troubleshooting</h2>
        <ul className="list-disc ml-5 space-y-1 text-sm">
          <li>If autofill causes issues, type email/password manually.</li>
          <li>If you don’t receive confirmation email, check spam/junk.</li>
        </ul>
      </section>
    </main>
  );
}
