"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Settings, Building2, Search, FileCode2, FolderOpen, FolderClosed, ChevronDown, ChevronRight, MapPin, ListChecks, LayoutGrid , ShieldCheck } from "lucide-react";
import { useState, useEffect, useCallback, Suspense } from "react";
import { getVisibleClients, loadVisibleClientIds } from "@/lib/visible-clients";
import { loadApiClients } from "@/lib/clients";
import { useAccess } from "@/lib/auth/use-access";
import { migrateLocalStorageToSupabase } from "@/lib/migrate-to-supabase";
import { loadClientGroups, type GroupWithMembers } from "@/lib/client-groups";
import { bouwHierarchie, beschikbareAssen, type GroepAs, type Tak } from "@/lib/groepen/hierarchie";
import { supabase } from "@/lib/supabase";
import { visibleGeoClones, type GeoCloneVariant } from "@/lib/rai/geo-clone-catalog";
import { BRAND_NAME } from "@/lib/branding/brand";

interface VisibleClient {
  id: string;
  name: string;
}

// Fase 3 geo-clone-projecten: de beurzen/geo-clones van de ACTIEVE klant hangen als
// sub-items onder die klant in het menu (event -> geo-clones), gedetecteerd uit de
// campagnenamen. Een sub-item opent de klant met de beurs-scope voorgeselecteerd (?geo=).

const AS_LABEL: Record<GroepAs, string> = {
  merk: "Merk",
  specialist: "Specialist",
  vrij: "Map",
};

/**
 * Eén tak van de groepsboom, met zijn subtakken.
 *
 * Recursief en niet twee keer uitgeschreven, want de tweede laag gedraagt zich precies als de
 * eerste: inklapbaar, met een telling, met een restbak. Twee kopieën zouden binnen een maand uit
 * elkaar lopen op precies het soort detail dat niemand naleest.
 */
function TakBlok({ tak, diepte, ingeklapt, wissel, Link }: {
  tak: Tak<VisibleClient>;
  diepte: number;
  ingeklapt: Set<string>;
  wissel: (id: string) => void;
  Link: (p: { client: VisibleClient }) => React.ReactElement;
}) {
  const sleutel = tak.groepId ?? `rest-${diepte}`;
  const dicht = ingeklapt.has(sleutel);
  return (
    <div className={diepte === 0 ? "mb-1" : "mb-0.5"}>
      <button onClick={() => wissel(sleutel)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/75 transition-colors hover:bg-white/10 hover:text-white">
        {dicht ? <ChevronRight className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
        {dicht ? <FolderClosed className="h-3.5 w-3.5 shrink-0" /> : <FolderOpen className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate text-body font-medium">{tak.naam}</span>
        {/* Een groep die nog een voorstel is, hoort ook hier als voorstel te lezen -- niet alleen
            op het instellingenscherm. Anders is een geraden indeling in de navigatie niet van een
            bevestigde te onderscheiden. */}
        {!tak.bevestigd && (
          <span className="rounded-full bg-amber-400/20 px-1.5 text-micro text-amber-200">voorstel</span>
        )}
        <span className="ml-auto text-micro text-white/30">{tak.aantal}</span>
      </button>
      {!dicht && (
        <div className="ml-4 mt-0.5 space-y-0.5">
          {tak.takken.map((sub) => (
            <TakBlok key={sub.groepId ?? `rest-${diepte + 1}`} tak={sub} diepte={diepte + 1}
              ingeklapt={ingeklapt} wissel={wissel} Link={Link} />
          ))}
          {tak.klanten.map((client) => <Link key={client.id} client={client} />)}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  return (
    <Suspense fallback={<aside className="fixed left-0 top-0 bottom-0 w-72 bg-rm-blue z-50" />}>
      <SidebarInner />
    </Suspense>
  );
}

function SidebarInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeGeo = searchParams.get("geo");
  const activeClientId = pathname.startsWith("/client/") ? pathname.replace("/client/", "") : null;
  const [geoClones, setGeoClones] = useState<GeoCloneVariant[]>([]);

  // Geo-clones van de actieve klant detecteren uit de campagnenamen (lichte query).
  useEffect(() => {
    if (!activeClientId || !supabase) { setGeoClones([]); return; }
    let cancelled = false;
    // Nieuwste maanden eerst, en dat is geen kosmetiek. Zonder .order() mag Postgres elke
    // volgorde teruggeven, dus welke 2000 van de dertien maanden aan campagnerijen je krijgt
    // is willekeurig: bij meer dan ~150 campagnes kan een geo-kloon tussen twee page loads uit
    // de sidebar verdwijnen. Aflopend op maand maakt het bovendien inhoudelijk juister — een
    // kloon die een jaar geleden stopte hoort er niet meer te staan.
    supabase
      .from("ads_campaign_monthly")
      .select("campaign_name")
      .eq("client_id", activeClientId)
      .order("month", { ascending: false })
      .limit(2000)
      .then(({ data }) => {
        if (cancelled) return;
        const names = [...new Set((data ?? []).map((r) => String(r.campaign_name)))];
        setGeoClones(visibleGeoClones(names));
      });
    return () => { cancelled = true; };
  }, [activeClientId]);
  const access = useAccess();
  const [search, setSearch] = useState("");
  const [visibleClients, setVisibleClients] = useState<VisibleClient[]>([]);
  const [groups, setGroups] = useState<GroupWithMembers[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // De gekozen assen overleven een herlaad: wie op specialist werkt, werkt daar de hele dag op.
  const [hoofdAs, setHoofdAs] = useState<GroepAs | null>(null);
  const [tweedeAs, setTweedeAs] = useState<GroepAs | null>(null);

  useEffect(() => {
    try {
      const h = localStorage.getItem("groep-hoofdas");
      const t = localStorage.getItem("groep-tweedeas");
      if (h === "merk" || h === "specialist" || h === "vrij") setHoofdAs(h);
      if (t === "merk" || t === "specialist" || t === "vrij") setTweedeAs(t);
    } catch { /* privémodus: dan gewoon de standaard */ }
  }, []);

  function kiesAs(as: GroepAs) {
    // Nog een keer op dezelfde as klikken schakelt de tweede laag uit.
    const nieuw = as === hoofdAs ? null : as;
    if (as === hoofdAs) { setTweedeAs(null); try { localStorage.removeItem("groep-tweedeas"); } catch {} return; }
    setHoofdAs(nieuw);
    try { localStorage.setItem("groep-hoofdas", String(nieuw)); } catch {}
  }
  function kiesTweede(as: GroepAs) {
    const nieuw = as === tweedeAs ? null : as;
    setTweedeAs(nieuw);
    try {
      if (nieuw) localStorage.setItem("groep-tweedeas", nieuw);
      else localStorage.removeItem("groep-tweedeas");
    } catch { /* idem */ }
  }
  const [mounted, setMounted] = useState(false);

  // allSettled en geen all, en dat is het verschil tussen een zijbalk en een lege zijbalk.
  //
  // Deze drie laden alle drie uit app_settings in Supabase. Valt er één om -- geen netwerk, geen
  // sleutels, of een demo op een machine zonder backend -- dan verwerpt Promise.all het geheel en
  // wordt setVisibleClients NOOIT bereikt. Resultaat: "KLANTEN (0)" terwijl de klanten lokaal
  // gewoon bekend zijn, inclusief de demoklant die getAllClients() in demo-modus zelf toevoegt.
  //
  // Gezien in een doorloop op localhost: de calls naar app_settings gaven ERR_CONNECTION_RESET en
  // de zijbalk bleef leeg. Er stond geen foutmelding bij; de lijst was er gewoon niet.
  //
  // Met allSettled zetten we altijd wat we lokaal weten, en vult wat wél laadt dat aan.
  const refreshData = useCallback(async () => {
    // EERST zetten wat lokaal bekend is. getVisibleClients() leest uit de klantregistratie plus
    // localStorage en heeft de calls hieronder niet nodig; in demo-modus zit de demoklant er al
    // in. Wachtte de zijbalk op die calls, dan stond er "KLANTEN (0)" zolang de backend niet
    // antwoordde -- en op een machine zonder backend dus voorgoed. Gemeten: die calls settelden
    // niet binnen zeven seconden, dus allSettled alleen was niet genoeg. Dat beschermt tegen een
    // fout, niet tegen wachten.
    setVisibleClients(getVisibleClients());

    const [, , groepen] = await Promise.allSettled([
      loadApiClients(),
      loadVisibleClientIds(),
      loadClientGroups(),
    ]);
    // En daarna bijwerken met wat de gedeelde instellingen alsnog opleveren.
    setVisibleClients(getVisibleClients());
    if (groepen.status === "fulfilled") setGroups(groepen.value);
  }, []);

  useEffect(() => {
    async function init() {
      // De migratie mag de lijst niet gijzelen: hij praat met dezelfde backend die er misschien
      // niet is. Faalt hij, dan is dat jammer voor de migratie en niet voor de navigatie.
      await migrateLocalStorageToSupabase().catch(() => {});
      await refreshData();
    }
    init();
    setMounted(true);

    function onStorage() {
      setVisibleClients(getVisibleClients());
    }
    function onGroupsChanged() {
      refreshData();
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener("visible-clients-changed", onStorage);
    window.addEventListener("clients-changed", onStorage);
    window.addEventListener("groups-changed", onGroupsChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("visible-clients-changed", onStorage);
      window.removeEventListener("clients-changed", onStorage);
      window.removeEventListener("groups-changed", onGroupsChanged);
    };
  }, [refreshData]);

  function toggleGroup(groupId: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  // Filter op zoekterm en op de eigen beurs-scope. Zolang de auth-enforcement uit staat
  // laat canAccessClient alles door (zie lib/auth/use-access.ts); daarna houdt iemand van
  // Aquatech alleen Aquatech over in de lijst.
  const filtered = visibleClients.filter(
    (c) => c.name.toLowerCase().includes(search.toLowerCase()) && access.canAccessClient(c.id)
  );
  const filteredIds = new Set(filtered.map((c) => c.id));

  // ── Groeperen op een of twee assen ────────────────────────────────────────
  //
  // Hiervoor stonden alle groepen plat naast elkaar. Zodra dezelfde accounts zowel een merk als
  // een specialist hebben, verscheen elk account twee keer in de lijst -- eenmaal onder "MPC" en
  // eenmaal onder "Edwin" -- zonder dat iets zei dat het hetzelfde account was. Bij vier groepen
  // valt dat mee; bij veertig specialisten en achthonderd accounts niet meer.
  //
  // Nu één hoofdas, met de andere as als tweede laag eronder. Elk account staat dan precies één
  // keer in de boom; lib/groepen/__hierarchie_test.ts houdt dat vast, ook op 800 accounts.
  const assen = beschikbareAssen(groups);

  // Groepen ZONDER soort tellen als "vrije map".
  //
  // Zonder deze regel verdwijnen ze uit de zijbalk, en dat is precies de stand van vandaag: drie
  // van de vier groepen in de database zijn gemaakt voordat `soort` bestond en staan dus op null.
  // Een gebruiker die deze versie installeert zou zijn mappen kwijt zijn en niets zien dat uitlegt
  // waarom. Ze horen te blijven staan tot iemand ze indeelt, niet ervoor.
  const groepenMetAs = groups.map((g) => (g.soort ? g : { ...g, soort: "vrij" as GroepAs }));
  const beschikbaar = beschikbareAssen(groepenMetAs);

  const actieveHoofdAs = hoofdAs && beschikbaar.includes(hoofdAs) ? hoofdAs : beschikbaar[0] ?? null;
  const actieveTweedeAs = tweedeAs && tweedeAs !== actieveHoofdAs && beschikbaar.includes(tweedeAs) ? tweedeAs : null;

  const boom: Tak<VisibleClient>[] = actieveHoofdAs
    ? bouwHierarchie(filtered, groepenMetAs, actieveHoofdAs, actieveTweedeAs)
    : [];
  // Helemaal geen groepen: dan de kale lijst, zoals het altijd was.
  const zonderIndeling = actieveHoofdAs ? [] : filtered;

  const totalCount = filtered.length;

  function ClientLink({ client }: { client: VisibleClient }) {
    const isActive = pathname === `/client/${client.id}`;
    const showGeoClones = isActive && geoClones.length > 0;
    return (
      <div>
        <Link
          href={`/client/${client.id}`}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
            isActive && !activeGeo
              ? "bg-rm-orange text-white font-medium"
              : isActive
              ? "bg-white/10 text-white"
              : "text-white/70 hover:bg-white/10 hover:text-white"
          }`}
        >
          <Building2 className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{client.name}</span>
        </Link>
        {/* De beurzen/geo-clones van dit event als sub-projecten (Fase 3). */}
        {showGeoClones && (
          <div className="ml-5 mt-0.5 space-y-0.5 border-l border-white/10 pl-2">
            {geoClones.map((v) => (
              <Link
                key={v.abbreviation}
                href={`/client/${client.id}?geo=${v.abbreviation}`}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-body transition-colors ${
                  activeGeo === v.abbreviation
                    ? "bg-rm-orange text-white font-medium"
                    : "text-white/80 hover:bg-white/10 hover:text-white"
                }`}
              >
                <MapPin className="w-3 h-3 shrink-0" />
                <span className="truncate">{v.brand} {v.location}</span>
                <span className="ml-auto text-micro opacity-60">{v.abbreviation}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-72 bg-rm-blue flex flex-col z-50">
      {/* Logo.

          ── GEEN <h1> ─────────────────────────────────────────────────────────
          Dit was een <h1>, en de zijbalk staat op elke pagina. Nagemeten: elke pagina had er
          daardoor twee, en die van de zijbalk kwam eerst in de DOM. Wie met een schermlezer op
          kopniveau door de pagina springt, landt dus altijd eerst op de productnaam en nooit op
          waar hij is -- en "Ctrl PPC" is geen paginatitel maar een merk.

          Een <p> met dezelfde opmaak. Visueel verandert er niets; de koppenstructuur begint nu
          bij de titel van de pagina zelf. */}
      <div className="p-6 pb-4">
        <p className="text-xl font-bold tracking-tight text-white">
          {BRAND_NAME}
        </p>
        <p className="mt-1 text-meta text-white/90">SEA Dashboard</p>
      </div>

      {/* Search */}
      <div className="px-4 pb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/60" />
          <input
            type="text"
            placeholder="Zoek klant..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white/10 text-white text-sm rounded-lg pl-9 pr-3 py-2 placeholder:text-white/65 border border-white/10 focus:outline-none focus:border-rm-orange"
          />
        </div>
      </div>

      {/* Primaire nav: de dagelijkse cockpit + het klassieke scorebord */}
      <div className="px-3 pb-2 space-y-0.5">
        <Link
          href="/"
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
            pathname === "/" ? "bg-rm-orange text-white font-medium" : "text-white/70 hover:bg-white/10 hover:text-white"
          }`}
        >
          <ListChecks className="w-4 h-4" />
          Vandaag
        </Link>
        <Link
          href="/portfolio"
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
            pathname === "/portfolio" ? "bg-rm-orange text-white font-medium" : "text-white/70 hover:bg-white/10 hover:text-white"
          }`}
        >
          <LayoutGrid className="w-4 h-4" />
          Portfolio
        </Link>
      </div>

      {/* Client list with groups */}
      <div className="flex-1 overflow-y-auto px-3 space-y-0.5">
        <p className="text-white/90 text-meta font-semibold uppercase tracking-wider px-3 py-2">
          Klanten{mounted ? ` (${totalCount})` : ""}
        </p>

        {/* Grouped clients */}
        {/* Waarop wordt gegroepeerd. Alleen tonen als er iets te kiezen valt: bij één as is een
            keuzeknop met één knop alleen maar ruis. */}
        {beschikbaar.length > 1 && (
          <div className="mb-2 px-1">
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-micro text-white/40 mr-0.5">Groepeer op</span>
              {beschikbaar.map((as) => (
                <button key={as} onClick={() => kiesAs(as)}
                  className={`rounded-md px-1.5 py-0.5 text-micro font-medium transition-colors ${
                    actieveHoofdAs === as ? "bg-white/20 text-white" : "text-white/50 hover:bg-white/10 hover:text-white/80"}`}>
                  {AS_LABEL[as]}
                </button>
              ))}
            </div>
            {beschikbaar.length > 1 && actieveHoofdAs && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <span className="text-micro text-white/40 mr-0.5">daarbinnen</span>
                {beschikbaar.filter((a) => a !== actieveHoofdAs).map((as) => (
                  <button key={as} onClick={() => kiesTweede(as)}
                    className={`rounded-md px-1.5 py-0.5 text-micro transition-colors ${
                      actieveTweedeAs === as ? "bg-white/20 text-white" : "text-white/40 hover:bg-white/10 hover:text-white/70"}`}>
                    {AS_LABEL[as]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {boom.map((tak) => (
          <TakBlok key={tak.groepId ?? "rest"} tak={tak} diepte={0}
            ingeklapt={collapsedGroups} wissel={toggleGroup} Link={ClientLink} />
        ))}

        {zonderIndeling.map((client) => (
          <ClientLink key={client.id} client={client} />
        ))}
      </div>

      {/* Bottom nav */}
      <div className="p-3 border-t border-white/10 space-y-0.5">
        <Link
          href="/scripts"
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
            pathname === "/scripts"
              ? "bg-rm-orange text-white font-medium"
              : "text-white/70 hover:bg-white/10 hover:text-white"
          }`}
        >
          <FileCode2 className="w-4 h-4" />
          Scripts
        </Link>
        {/* Beheer stond nergens in de navigatie: de pagina bestond wel maar was alleen bereikbaar
            door /admin in te typen. Een beheerscherm dat niemand kan vinden wordt niet gebruikt,
            en sinds het stoplicht voor bureaugebruik erop staat is dat een gemis.

            `can("user:manage")` en niet de rol: zodra de rechtenmatrix verandert, verandert deze
            link mee. Zolang de enforcement uit staat geeft `can` overal true terug (zie
            use-access.ts) -- dan is de link zichtbaar en de ROUTE nog steeds dicht, want die
            controleert server-side. Zichtbaar zonder recht is hier het veilige verschil. */}
        {access.can("user:manage") && (
          <Link
            href="/admin"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
              pathname === "/admin"
                ? "bg-rm-orange text-white font-medium"
                : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            Beheer
          </Link>
        )}
        <Link
          href="/settings"
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
            pathname === "/settings"
              ? "bg-rm-orange text-white font-medium"
              : "text-white/70 hover:bg-white/10 hover:text-white"
          }`}
        >
          <Settings className="w-4 h-4" />
          Instellingen
        </Link>
      </div>
    </aside>
  );
}
