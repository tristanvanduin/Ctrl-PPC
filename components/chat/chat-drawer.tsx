"use client";

// De spar-assistent als uitschuifbaar paneel.
//
// ── WAAROM EEN DRAWER EN GEEN PAGINA ────────────────────────────────────────
//
// Het gesprek gaat over wat er op het scherm staat. Een aparte pagina zou betekenen dat je de
// cijfers verlaat om erover te kunnen praten, en dan typ je ze over of je scrollt heen en weer.
// Het paneel schuift over het dashboard heen en laat de linkerkant zichtbaar.
//
// ── HET LICENTIESLOT ────────────────────────────────────────────────────────
//
// De knop verschijnt alleen bij een premium bureau, maar dat is netheid en geen beveiliging: de
// route weigert het verzoek zelf ook (403). Beide kanten gebruiken dezelfde magChatten() uit
// lib/chat/toegang.ts -- twee kopieën van dezelfde regel lopen uit elkaar zodra er één verandert.
//
// Zolang de licentie nog niet geladen is verschijnt er NIETS. Niet de knop vast tonen en later
// weghalen: dan ziet iemand een functie die voor zijn ogen verdwijnt, en dat leest als een storing.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, X, Send, Loader2, AlertCircle } from "lucide-react";
import { magChatten } from "@/lib/chat/toegang";

/**
 * Het aanhechtingspunt in de bovenbalk. Deze id staat óók in components/layout/top-bar.tsx.
 * Verandert hij daar, dan valt de knop hier terug op zijn oude zwevende plek -- zichtbaar dus,
 * en niet stilzwijgend weg.
 */
const TOPBALK_SLOT = "topbalk-acties";

/**
 * De knop zelf, los van waar hij landt. Zo is hij identiek in de bovenbalk en in de terugval,
 * en is er geen tweede versie die na een wijziging anders gaat lezen.
 */
function SparKnop({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-9 items-center gap-2 rounded-full bg-rm-orange px-3.5 text-body font-medium text-white transition-colors hover:brightness-110"
      aria-label="Spar over deze klant"
    >
      <MessageSquare className="h-4 w-4 shrink-0" />
      Sparren
    </button>
  );
}

type Bericht = {
  id?: string;
  rol: "user" | "assistant";
  inhoud: string;
  model?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
};

type Verbruik = { prompt_tokens: number; completion_tokens: number; gecacht: number };

export function ChatDrawer({ clientId, klantnaam }: { clientId: string; klantnaam: string }) {
  const [licentie, setLicentie] = useState<string | null>(null);
  // De naam komt van de server en niet uit de prop. app/client/[clientId]/page.tsx geeft
  // `name: clientId` door -- voor élke klant, niet alleen de demo -- dus de prop is daar het id.
  // De route weet de echte naam wél (accounts.name). De prop blijft als terugval voor het geval
  // de aanroeper hem ooit goed meegeeft.
  const [naam, setNaam] = useState(klantnaam);
  const [open, setOpen] = useState(false);
  const [berichten, setBerichten] = useState<Bericht[]>([]);
  const [invoer, setInvoer] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [laatsteVerbruik, setLaatsteVerbruik] = useState<Verbruik | null>(null);
  const bodemRef = useRef<HTMLDivElement>(null);

  // Het aanhechtingspunt in de bovenbalk, ná de eerste verf gezocht: op de server bestaat er geen
  // document, en tijdens hydratatie moet de eerste render aan beide kanten hetzelfde zijn. Null
  // op de eerste doorloop betekent dus niet "de balk is er niet" maar "we weten het nog niet";
  // de terugval hieronder verschijnt daardoor kort. Dat is één frame en zichtbaar noch erg -- de
  // knop hangt sowieso achter de licentiecheck, die pas na een netwerkcall antwoord geeft.
  const [aanhechting, setAanhechting] = useState<HTMLElement | null>(null);
  useEffect(() => { setAanhechting(document.getElementById(TOPBALK_SLOT)); }, []);

  // De licentie één keer ophalen. Faalt dat, dan blijft licentie null en verschijnt de knop niet
  // -- een mislukte check hoort geen toegang te geven.
  useEffect(() => {
    let levend = true;
    fetch(`/api/chat?client_id=${encodeURIComponent(clientId)}`)
      .then((r) => (r.ok ? r.json() : r.json().then((j) => ({ licentie: j.licentie ?? "basis" }))))
      .then((j) => {
        if (!levend) return;
        setLicentie(String(j.licentie ?? "basis"));
        if (j.klantnaam) setNaam(String(j.klantnaam));
      })
      .catch(() => { if (levend) setLicentie("basis"); });
    return () => { levend = false; };
  }, [clientId]);

  useEffect(() => { setNaam(klantnaam); }, [clientId, klantnaam]);

  // Bij een nieuwe klant begint het gesprek opnieuw. Zonder dit blijf je in het gesprek van de
  // vorige klant zitten terwijl de context van de nieuwe komt -- en dat zie je aan niets.
  useEffect(() => {
    setBerichten([]);
    setSessionId(null);
    setLaatsteVerbruik(null);
    setFout(null);
  }, [clientId]);

  useEffect(() => {
    if (open) bodemRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [berichten, open]);

  // Escape sluit het paneel. Verwachting bij alles wat over de pagina heen schuift.
  useEffect(() => {
    if (!open) return;
    const opToets = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", opToets);
    return () => window.removeEventListener("keydown", opToets);
  }, [open]);

  const verstuur = useCallback(async () => {
    const vraag = invoer.trim();
    if (!vraag || bezig) return;
    setInvoer("");
    setFout(null);
    setBerichten((b) => [...b, { rol: "user", inhoud: vraag }]);
    setBezig(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: clientId, bericht: vraag, session_id: sessionId }),
      });
      const j = await res.json();
      if (!res.ok) {
        setFout(String(j.error ?? "Er ging iets mis."));
        return;
      }
      setSessionId(String(j.session_id));
      setBerichten((b) => [...b, { rol: "assistant", inhoud: String(j.antwoord), model: j.model }]);
      if (j.verbruik) setLaatsteVerbruik(j.verbruik as Verbruik);
    } catch {
      setFout("Geen verbinding met de server.");
    } finally {
      setBezig(false);
    }
  }, [invoer, bezig, clientId, sessionId]);

  if (licentie === null || !magChatten(licentie)) return null;

  return (
    <>
      {/* De knop.

          ── HIJ ZWEEFDE, EN DEKTE DAARMEE DATA AF ─────────────────────────────────
          Dit was een pil van 115 bij 44 rechtsonder vast. Nagemeten op het tabblad
          Sprintplanning lag hij op twee cellen van de kolom Metrics ("conversions" en "cost").
          Kleiner maken hielp maar half: als cirkel van 52 bij 44 raakte hij nog stééds diezelfde
          twee cellen. Dat is geen kwestie van maat -- de hoek rechtsonder is nu eenmaal waar een
          tabel zijn laatste kolom heeft, dus een vaste knop dáár ligt altijd op iets.

          Nu staat hij in de bovenbalk, naast de bel. Daar dekt hij per definitie niets af, hij
          staat op elk tabblad op dezelfde plek, en hij is meteen zichtbaar in plaats van pas als
          je naar beneden kijkt. Wat je opgeeft is de vaste positie tijdens het scrollen -- maar
          de balk is `sticky top-0`, dus die is er alsnog.

          ── WAAROM EEN PORTAL EN GEEN KNOP IN DE BOVENBALK ────────────────────────
          De bovenbalk staat in de root-layout en weet niets van welke klant er open is; dit
          component wel. Een portal laat de eigenaar van de toestand ook de eigenaar van de knop
          blijven, in plaats van de klantcontext door de layout te trekken.

          De terugval is met opzet en niet defensief geneuzel: is het aanhechtingspunt er niet
          (een andere layout, een pagina zonder bovenbalk), dan zweeft hij weer rechtsonder. Een
          knop die verdwijnt omdat een id is hernoemd, is erger dan een knop die iets afdekt. */}
      {!open && (
        aanhechting
          ? createPortal(<SparKnop onClick={() => setOpen(true)} />, aanhechting)
          : <div className="fixed bottom-6 right-6 z-40"><SparKnop onClick={() => setOpen(true)} /></div>
      )}

      {open && (
        <>
          {/* Een klik naast het paneel sluit het. Geen donkere overlay: het dashboard moet
              leesbaar blijven, want daar gaat het gesprek over. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />

          <aside
            className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-2xl"
            role="dialog"
            aria-label={`Sparren over ${naam}`}
          >
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-rm-blue-ink">Sparren</h2>
                <p className="truncate text-meta text-muted-foreground">{naam}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Sluiten"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {berichten.length === 0 && (
                <div className="rounded-lg border border-dashed border-border px-3 py-4">
                  <p className="text-sm text-muted-foreground">
                    Stel een vraag over de cijfers van {naam}. De assistent kent de maandcijfers,
                    de campagnes en het hypothese-logboek van deze klant.
                  </p>
                </div>
              )}

              {berichten.map((b, i) => (
                <div key={b.id ?? i} className={b.rol === "user" ? "flex justify-end" : ""}>
                  <div
                    className={
                      b.rol === "user"
                        ? "max-w-[85%] rounded-lg rounded-br-sm bg-muted px-3 py-2 text-sm text-foreground"
                        : "max-w-[95%] whitespace-pre-wrap text-sm leading-relaxed text-foreground"
                    }
                  >
                    {b.inhoud}
                  </div>
                </div>
              ))}

              {bezig && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Aan het nadenken...
                </div>
              )}

              {fout && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <p className="text-meta leading-snug text-amber-900">{fout}</p>
                </div>
              )}

              <div ref={bodemRef} />
            </div>

            {/* Het verbruik van de laatste beurt, zichtbaar. De contextkosten zijn voor de
                gebruiker onzichtbaar terwijl ze het grootste deel van de rekening zijn -- dan
                horen ze op zijn minst afleesbaar te zijn. */}
            {laatsteVerbruik && (
              <div className="border-t border-border px-4 py-1.5">
                <p className="text-meta text-muted-foreground">
                  Laatste bericht: {laatsteVerbruik.prompt_tokens.toLocaleString("nl-NL")} tokens context
                  {laatsteVerbruik.gecacht > 0 && ` (${laatsteVerbruik.gecacht.toLocaleString("nl-NL")} gecacht)`}
                  , {laatsteVerbruik.completion_tokens.toLocaleString("nl-NL")} antwoord
                </p>
              </div>
            )}

            <div className="border-t border-border p-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={invoer}
                  onChange={(e) => setInvoer(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter verstuurt, shift+enter maakt een regel. De omgekeerde keuze kost bij
                    // elk bericht een muisbeweging.
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void verstuur(); }
                  }}
                  rows={2}
                  placeholder="Vraag iets over deze klant..."
                  className="min-h-[2.5rem] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-rm-orange"
                  disabled={bezig}
                />
                <button
                  onClick={() => void verstuur()}
                  disabled={bezig || invoer.trim().length === 0}
                  className="rounded-lg bg-rm-orange p-2.5 text-white transition-opacity disabled:opacity-40"
                  aria-label="Versturen"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
