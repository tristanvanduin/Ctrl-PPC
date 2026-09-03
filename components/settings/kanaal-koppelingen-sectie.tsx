"use client";

// Kanaalkoppelingen per klant: welk Meta-, LinkedIn- of Microsoft-account hoort bij welke klant.
//
// De KoppelingKaart hierboven op de pagina regelt het TOKEN van het bureau (agency_connections).
// Deze sectie regelt de stap die tot 3 september 2026 ontbrak: de rij per klant in
// meta_connections / linkedin_connections / microsoft_connections waar de kanaalsyncs op
// draaien. Zonder die rij eindigt elke sync in "geen koppeling" en elke kanaalanalyse in "geen
// data". Alles loopt via /api/kanaal-koppeling (lezen, accountlijst, koppelen, ontkoppelen) en
// /api/sync/<kanaal> (backfill starten).

import { useState, useEffect, useCallback } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw, Link2, Unlink, DownloadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAllClients, type Client } from "@/lib/clients";

type Kanaal = "meta" | "linkedin" | "microsoft";

interface BureauStand { status: string | null; heeftToken: boolean; bruikbaar: boolean; bron: "bureau" | "omgeving" | null }
interface KanaalStand {
  kanaal: Kanaal;
  label: string;
  gekoppeld: boolean;
  accountId: string | null;
  customerId: string | null;
  status: string | null;
  laatsteSync: string | null;
  laatsteFout: string | null;
  valuta: string | null;
  laatsteRun: { status: string | null; gestart: string | null; fout: string | null } | null;
  dagstand: { toestand: "actueel" | "achter" | "dood" | "geen"; tekst: string };
}
interface Overzicht {
  client_id: string;
  demo: boolean;
  bureau: { agencyId: string | null; perKanaal: Record<Kanaal, BureauStand> };
  kanalen: KanaalStand[];
}
interface KanaalAccount { id: string; naam: string; valuta: string | null; status: string | null }

const KANAAL_HINT: Record<Kanaal, { idLabel: string; idVoorbeeld: string; bureauLabel: string }> = {
  meta: { idLabel: "Ad-account-id", idVoorbeeld: "act_1234567890 of 1234567890", bureauLabel: "Meta Ads" },
  linkedin: { idLabel: "Ad-account-URN", idVoorbeeld: "urn:li:sponsoredAccount:5085 of 5085", bureauLabel: "LinkedIn Ads" },
  microsoft: { idLabel: "Account-id", idVoorbeeld: "1234567", bureauLabel: "Microsoft Advertising" },
};

function datumKort(iso: string | null): string {
  if (!iso) return "nooit";
  return iso.slice(0, 16).replace("T", " ");
}

export function KanaalKoppelingenSectie() {
  const [clients] = useState<Client[]>(() => getAllClients().filter((c) => c.source !== "demo"));
  const [clientId, setClientId] = useState<string>(() => clients[0]?.id ?? "");
  const [overzicht, setOverzicht] = useState<Overzicht | null>(null);
  const [laden, setLaden] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  const laad = useCallback(async () => {
    if (!clientId) return;
    setLaden(true);
    setFout(null);
    try {
      const res = await fetch(`/api/kanaal-koppeling?client_id=${encodeURIComponent(clientId)}`);
      const data = (await res.json()) as Overzicht & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setOverzicht(data);
    } catch (e) {
      setOverzicht(null);
      setFout(e instanceof Error ? e.message : "Overzicht laden mislukt");
    } finally {
      setLaden(false);
    }
  }, [clientId]);

  useEffect(() => { void laad(); }, [laad]);

  return (
    <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <h3 className="font-semibold text-brand-blue-ink text-title">Kanaalkoppelingen per klant</h3>
          <p className="text-xs text-muted-foreground mt-1">
            De platformkoppelingen hierboven geven het bureau een token. Hier zeg je welk Meta-, LinkedIn- of
            Microsoft-account bij welke klant hoort; pas dan kan de nachtsync voor dat kanaal draaien en heeft
            de kanaalanalyse data.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void laad()} disabled={laden || !clientId}>
          {laden ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Vernieuwen
        </Button>
      </div>

      {clients.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-3">
          Geen echte klanten bekend. Koppel eerst Google Ads (of voeg klanten toe); de demo-klant draait op demodata en heeft geen kanaalkoppeling nodig.
        </p>
      ) : (
        <>
          <label className="block mt-3 mb-4">
            <span className="text-xs font-semibold text-brand-gray">Klant</span>
            <select
              className="mt-1 block w-full max-w-md rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
              ))}
            </select>
          </label>

          {fout && (
            <div className="px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-xs text-red-700 mb-4">{fout}</div>
          )}

          {overzicht && overzicht.client_id === clientId && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {overzicht.kanalen.map((stand) => (
                <KanaalKaart
                  key={stand.kanaal}
                  clientId={clientId}
                  stand={stand}
                  bureau={overzicht.bureau.perKanaal[stand.kanaal]}
                  onGewijzigd={() => void laad()}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DagstandRegel({ dagstand }: { dagstand: KanaalStand["dagstand"] }) {
  const kleur = dagstand.toestand === "actueel" ? "text-green-700" : dagstand.toestand === "achter" ? "text-amber-700" : "text-red-700";
  const Icoon = dagstand.toestand === "actueel" ? CheckCircle2 : dagstand.toestand === "achter" ? AlertTriangle : XCircle;
  return (
    <p className={`flex items-start gap-1.5 text-xs ${kleur}`}>
      <Icoon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span>{dagstand.tekst}</span>
    </p>
  );
}

function KanaalKaart({ clientId, stand, bureau, onGewijzigd }: { clientId: string; stand: KanaalStand; bureau: BureauStand; onGewijzigd: () => void }) {
  const hint = KANAAL_HINT[stand.kanaal];
  const [accounts, setAccounts] = useState<KanaalAccount[] | null>(null);
  const [accountsFout, setAccountsFout] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");
  const [customerId, setCustomerId] = useState(stand.customerId ?? "");
  const [bezig, setBezig] = useState<"accounts" | "koppelen" | "ontkoppelen" | "backfill" | null>(null);
  const [melding, setMelding] = useState<{ soort: "ok" | "fout"; tekst: string } | null>(null);

  async function haalAccounts() {
    setBezig("accounts");
    setAccountsFout(null);
    setMelding(null);
    try {
      const res = await fetch(`/api/kanaal-koppeling?client_id=${encodeURIComponent(clientId)}&accounts=${stand.kanaal}`);
      const data = (await res.json()) as { accounts?: KanaalAccount[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const lijst = data.accounts ?? [];
      setAccounts(lijst);
      if (lijst.length === 1) setAccountId(lijst[0].id);
    } catch (e) {
      setAccounts(null);
      setAccountsFout(e instanceof Error ? e.message : "Accounts ophalen mislukt");
    } finally {
      setBezig(null);
    }
  }

  async function koppel() {
    setBezig("koppelen");
    setMelding(null);
    try {
      const gekozen = accounts?.find((a) => a.id === accountId) ?? null;
      const res = await fetch("/api/kanaal-koppeling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId, kanaal: stand.kanaal, account_id: accountId,
          customer_id: stand.kanaal === "microsoft" && customerId ? customerId : undefined,
          currency: gekozen?.valuta ?? undefined,
        }),
      });
      const data = (await res.json()) as { error?: string; account_id?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMelding({ soort: "ok", tekst: `Gekoppeld aan ${data.account_id}. Start een backfill om de historie op te halen.` });
      setAccountId("");
      onGewijzigd();
    } catch (e) {
      setMelding({ soort: "fout", tekst: e instanceof Error ? e.message : "Koppelen mislukt" });
    } finally {
      setBezig(null);
    }
  }

  async function ontkoppel() {
    setBezig("ontkoppelen");
    setMelding(null);
    try {
      const res = await fetch("/api/kanaal-koppeling", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, kanaal: stand.kanaal }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMelding({ soort: "ok", tekst: "Ontkoppeld; de nachtsync slaat dit kanaal nu over." });
      onGewijzigd();
    } catch (e) {
      setMelding({ soort: "fout", tekst: e instanceof Error ? e.message : "Ontkoppelen mislukt" });
    } finally {
      setBezig(null);
    }
  }

  async function backfill() {
    setBezig("backfill");
    setMelding(null);
    try {
      const res = await fetch(`/api/sync/${stand.kanaal}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, scope: "backfill" }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; failed?: string[]; rows_upserted?: Record<string, unknown> };
      if (!res.ok || !data.ok) {
        const gefaald = (data.failed ?? []).join("; ");
        throw new Error(data.error ?? (gefaald || `HTTP ${res.status}`));
      }
      const rijen = Object.entries(data.rows_upserted ?? {}).filter(([, v]) => typeof v === "number").map(([k, v]) => `${k}: ${v}`).join(", ");
      setMelding({ soort: "ok", tekst: `Backfill klaar${rijen ? ` (${rijen})` : ""}.` });
      onGewijzigd();
    } catch (e) {
      setMelding({ soort: "fout", tekst: e instanceof Error ? e.message : "Backfill mislukt" });
    } finally {
      setBezig(null);
    }
  }

  const bureauTekst = bureau.bruikbaar
    ? `Bureautoken: ${bureau.bron === "bureau" ? "verbonden via OAuth" : "uit de omgevingsvariabelen"}`
    : `Geen bruikbaar ${hint.bureauLabel}-token voor het bureau (status: ${bureau.status ?? "niet verbonden"}). Verbind het platform eerst hierboven.`;

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm text-brand-blue-ink">{stand.label}</h4>
        {stand.gekoppeld ? (
          <span className="flex items-center gap-1 text-xs font-semibold text-green-600"><CheckCircle2 className="w-3.5 h-3.5" /> Gekoppeld</span>
        ) : (
          <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground"><XCircle className="w-3.5 h-3.5" /> Niet gekoppeld</span>
        )}
      </div>

      <p className={`text-xs ${bureau.bruikbaar ? "text-muted-foreground" : "text-amber-700"}`}>{bureauTekst}</p>

      {stand.gekoppeld && (
        <div className="space-y-1.5 text-xs">
          <p><span className="text-brand-gray font-semibold">Account:</span> <code className="font-mono">{stand.accountId}</code>{stand.customerId ? <> · customer <code className="font-mono">{stand.customerId}</code></> : null}{stand.valuta ? ` · ${stand.valuta}` : ""}</p>
          <p><span className="text-brand-gray font-semibold">Status:</span> {stand.status}{stand.laatsteFout ? <span className="text-red-700"> — {stand.laatsteFout}</span> : null}</p>
          <p><span className="text-brand-gray font-semibold">Laatste geslaagde sync:</span> {datumKort(stand.laatsteSync)}</p>
          {stand.laatsteRun && (
            <p><span className="text-brand-gray font-semibold">Laatste run:</span> {stand.laatsteRun.status ?? "?"} op {datumKort(stand.laatsteRun.gestart)}{stand.laatsteRun.fout ? <span className="text-red-700"> — {stand.laatsteRun.fout}</span> : null}</p>
          )}
          <DagstandRegel dagstand={stand.dagstand} />
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" onClick={() => void backfill()} disabled={bezig !== null || !bureau.bruikbaar}>
              {bezig === "backfill" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <DownloadCloud className="w-3.5 h-3.5" />}
              Backfill starten
            </Button>
            <Button size="sm" variant="outline" onClick={() => void ontkoppel()} disabled={bezig !== null}>
              {bezig === "ontkoppelen" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />}
              Ontkoppelen
            </Button>
          </div>
        </div>
      )}

      {!stand.gekoppeld && (
        <div className="space-y-2">
          {stand.status === "disabled" && stand.accountId && (
            <p className="text-xs text-muted-foreground">Eerder gekoppeld aan <code className="font-mono">{stand.accountId}</code>, nu uitgezet.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void haalAccounts()} disabled={bezig !== null || !bureau.bruikbaar}>
              {bezig === "accounts" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Accounts ophalen
            </Button>
            {accounts && <span className="text-xs text-muted-foreground">{accounts.length} account{accounts.length === 1 ? "" : "s"} onder het bureautoken</span>}
          </div>
          {accountsFout && <p className="text-xs text-amber-700">{accountsFout}</p>}
          {accounts && accounts.length > 0 && (
            <select
              className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={accounts.some((a) => a.id === accountId) ? accountId : ""}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Kies een account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.naam} — {a.id}{a.valuta ? ` (${a.valuta})` : ""}{a.status ? ` [${a.status}]` : ""}</option>
              ))}
            </select>
          )}
          <label className="block">
            <span className="text-xs text-brand-gray font-semibold">{hint.idLabel} (of handmatig)</span>
            <input
              className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
              placeholder={hint.idVoorbeeld}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            />
          </label>
          {stand.kanaal === "microsoft" && (
            <label className="block">
              <span className="text-xs text-brand-gray font-semibold">Customer-id (beheerlaag; leeg = uit de bureaukoppeling)</span>
              <input
                className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
                placeholder="bijv. 987654"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              />
            </label>
          )}
          <Button size="sm" onClick={() => void koppel()} disabled={bezig !== null || !accountId.trim() || !bureau.bruikbaar}>
            {bezig === "koppelen" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
            Koppelen
          </Button>
          {stand.dagstand.toestand !== "geen" && <DagstandRegel dagstand={stand.dagstand} />}
        </div>
      )}

      {melding && (
        <p className={`text-xs ${melding.soort === "ok" ? "text-green-700" : "text-red-700"}`}>{melding.tekst}</p>
      )}
    </div>
  );
}
