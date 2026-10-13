export default function GmailPrivacy() {
  return (
    <main
      style={{
        height: "100dvh",
        overflowY: "auto",
        padding:
          "max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom))",
        maxWidth: 720,
        margin: "auto",
      }}
    >
      <h1>My Money · Gmail Privacy</h1>
      <p>
        Gmail Expense Sync reads likely financial messages received in the
        rolling seven days before you press Retrieve Email Data. Opening the
        application does not scan email. Gmail read-only permission is used; the
        app cannot send, modify or delete messages.
      </p>
      <p>
        Deterministic rules process plain text and HTML on the server. No email
        content is sent to an AI service. Full email bodies are not retained.
        Selected sender, subject, amount, currency, date, merchant, payment
        status, reference, Gmail message identifier and a content hash are
        retained for transaction evidence and review. Pending candidates do not
        count as spending.
      </p>
      <p>
        Google access and refresh tokens are encrypted on the server and kept in
        a private database table. Financial and email metadata are restricted to
        the approved owner and authorized devices through Supabase access
        controls. Hosting and database providers process data to deliver this
        feature. Data is not sold, used for advertising or used to train models.
        Google user data use complies with the Google API Services User Data
        Policy, including Limited Use requirements.
      </p>
      <p>
        Disconnect Gmail on Dashboard to stop access and remove local tokens.
        The app also requests Google token revocation. If it cannot confirm
        revocation, remove the app in your Google Account permissions. Existing
        expenses and selected audit evidence remain in your private ledger; the
        owner can request deletion through the contact below. Deleting a Gmail
        connection does not delete your financial records.
      </p>
      <p>
        Contact:{" "}
        {process.env.APP_SUPPORT_EMAIL ||
          "The application owner must configure a support contact before publishing this app."}
      </p>
      <p>
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noreferrer"
        >
          Google API Services User Data Policy
        </a>
      </p>
      <a href="/">Return to My Money</a>
    </main>
  );
}
