"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#070a09",
          color: "#f4fffb",
          padding: 24,
          textAlign: "center",
        }}
      >
        <div>
          <h1 style={{ fontSize: 28, marginBottom: 8 }}>Paypals is unavailable</h1>
          <p style={{ opacity: 0.7, marginBottom: 20, fontSize: 14 }}>
            A critical error occurred{error.digest ? ` (${error.digest})` : ""}.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              border: 0,
              borderRadius: 12,
              padding: "10px 18px",
              background: "#0d7a62",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
