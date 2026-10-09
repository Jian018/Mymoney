"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="shell center">
      <h1>Something went wrong</h1>
      <p>Your records remain in Supabase. Try loading again.</p>
      <button className="primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
