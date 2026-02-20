export default function HelpPage() {
  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Help</h1>

      <section className="border rounded p-4 bg-gray-50 space-y-2">
        <h2 className="font-semibold">Sign up (new users)</h2>
        <ol className="list-decimal ml-5 space-y-1 text-sm">
          <li>Go to the login page and enter your email + a password (6+ characters).</li>
          <li>Click <b>Sign up</b>.</li>
          <li>
            If you are told to confirm your email, open the email and confirm. Then return and
            click <b>Sign in</b>.
          </li>
        </ol>
      </section>

      <section className="border rounded p-4 bg-gray-50 space-y-2">
        <h2 className="font-semibold">Sign in (existing users)</h2>
        <ol className="list-decimal ml-5 space-y-1 text-sm">
          <li>Enter your email + password.</li>
          <li>Click <b>Sign in</b>.</li>
          <li>You’ll be taken to the tracker pages (Dashboard / Bets / Reports).</li>
        </ol>
      </section>

      <section className="border rounded p-4 bg-gray-50 space-y-2">
        <h2 className="font-semibold">Using the Bets Ledger</h2>
        <ul className="list-disc ml-5 space-y-1 text-sm">
          <li>Go to <b>Bets</b> and add a bet using the form.</li>
          <li>The bet will save to the database and persist after refresh.</li>
          <li>Grading / editing / exports are coming next (see roadmap).</li>
        </ul>
      </section>

      <section className="border rounded p-4 bg-gray-50 space-y-2">
        <h2 className="font-semibold">Troubleshooting</h2>
        <ul className="list-disc ml-5 space-y-1 text-sm">
          <li>If you don’t receive a confirmation email, check spam/junk.</li>
          <li>If autofill causes issues, type email/password manually.</li>
        </ul>
      </section>
    </main>
  );
}
