"use client";

// De laatste grens: alleen actief als de root-layout (app/layout.tsx) zelf breekt. Hij vervangt dan
// die layout, dus hij brengt zijn eigen <html> en <body> mee en leunt niet op de stijlen of het
// lettertype van de app: die kunnen juist het kapotte deel zijn. Vandaar de inline stijl.
// Dezelfde inhoud als de gewone melding (app/(app)/foutgrens.tsx): wat er misging, de foutcode
// voor de serverlogs, en opnieuw proberen.

import { useEffect } from "react";

export default function GlobaleFout({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[foutgrens] de hele app:", error);
  }, [error]);

  return (
    <html lang="nl">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fff", color: "#111" }}>
        <title>Er ging iets mis</title>
        <div role="alert" data-foutgrens="de hele app" style={{ maxWidth: 560, margin: "64px auto", padding: "0 16px" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 12px" }}>Er ging iets mis bij het laden van het dashboard.</h1>
          <p style={{ margin: "0 0 8px", overflowWrap: "anywhere" }}>{error?.message?.trim() || "Onbekende fout zonder melding."}</p>
          {error?.digest && (
            <p style={{ margin: "0 0 8px", fontSize: 13, color: "#555" }}>Foutcode {error.digest}: dezelfde code staat in de serverlogs.</p>
          )}
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{ marginTop: 8, padding: "8px 14px", border: 0, borderRadius: 6, background: "#b91c1c", color: "#fff", fontSize: 14, cursor: "pointer" }}
          >
            Opnieuw proberen
          </button>
        </div>
      </body>
    </html>
  );
}
