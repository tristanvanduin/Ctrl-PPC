"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { Bell, AlertTriangle, Info, X, Search, Menu } from "lucide-react";
import { getAllClients } from "@/lib/clients";
import { ThemaSchakelaar } from "@/components/ui/thema-schakelaar";
import { CommandPalette } from "./command-palette";
import { UserMenu } from "./user-menu";
import { useSidebarMobile } from "./sidebar-mobile-context";

interface Notification {
  clientName: string;
  clientId: string;
  severity: "critical" | "warning" | "info";
  message: string;
}

export function TopBar() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const { toggle: toggleSidebar } = useSidebarMobile();

  useEffect(() => {
    setMounted(true);

    // Fetch notifications from overview data
    async function loadNotifications() {
      try {
        const clients = getAllClients().filter((c) => c.id.startsWith("gads-"));
        if (clients.length === 0) return;

        const customerIds = clients.map((c) => c.id.replace("gads-", "")).join(",");
        const res = await fetch(`/api/google-ads/overview?customerIds=${customerIds}`);
        const data = await res.json();

        const notifs: Notification[] = [];
        for (const account of data.accounts || []) {
          const client = clients.find((c) => c.id === `gads-${account.customerId}`);
          const name = client?.name ?? account.customerId;
          const clientId = client?.id ?? "";

          if (account.ytd) {
            // YoY decline > 20%
            if (account.yoy?.convChange !== null && account.yoy.convChange < -20) {
              notifs.push({
                clientName: name, clientId,
                severity: "critical",
                message: `Conversies ${Math.round(account.yoy.convChange)}% YoY`,
              });
            }
            // Very low ROAS
            if (account.ytd.roas > 0 && account.ytd.roas < 1) {
              notifs.push({
                clientName: name, clientId,
                severity: "warning",
                message: `ROAS ${account.ytd.roas.toFixed(1)}x — onder break-even`,
              });
            }
            // High CPA (> €200)
            if (account.ytd.cpa > 200) {
              notifs.push({
                clientName: name, clientId,
                severity: "warning",
                message: `CPA ${new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(account.ytd.cpa)}`,
              });
            }
          }
          if (account.error) {
            notifs.push({
              clientName: name, clientId,
              severity: "info",
              message: "Fout bij ophalen data",
            });
          }
        }

        notifs.sort((a, b) => {
          const order = { critical: 0, warning: 1, info: 2 };
          return order[a.severity] - order[b.severity];
        });
        setNotifications(notifs);
      } catch { /* ignore */ }
    }

    loadNotifications();
  }, []);

  // Close panel on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const getTitle = () => {
    if (pathname === "/") return "Ctrl PPC";
    if (pathname === "/vandaag") return "Vandaag";
    if (pathname === "/portfolio") return "Klantoverzicht";
    if (pathname === "/settings") return "Instellingen";
    if (!mounted) return "Dashboard";
    const clientId = pathname.replace("/client/", "");
    const client = getAllClients().find((c) => c.id === clientId);
    return client?.name || "Dashboard";
  };

  const criticalCount = notifications.filter((n) => n.severity === "critical").length;
  const totalCount = notifications.length;

  return (
    // Glas met reden: deze balk staat op `sticky top-0`, dus de hele pagina schuift er letterlijk
    // onderdoor. Er is dus een achtergrond om te vervagen en je ziet de inhoud bewegen. Op een
    // kaart zou hetzelfde effect niets doen — daar ligt alleen een egaal paginavlak onder.
    //
    // Dezelfde toets geldt voor de andere plekken waar het staat: de grafiektooltip, het
    // meldingenpaneel hieronder, de periodekiezer en de chip op de merkbalk. Vier plekken, alle
    // vier met inhoud eronder. Waar die inhoud er niet is, staat het er niet.
    //
    // `supports-[backdrop-filter]` houdt de balk dicht op browsers die het niet kunnen; zonder
    // die terugval wordt hij daar half doorzichtig zónder vervaging, en loopt de tekst van de
    // pagina dwars door de titel heen.
    <header className="h-16 border-b border-border bg-card supports-[backdrop-filter]:bg-[var(--balk-vlak)] supports-[backdrop-filter]:backdrop-blur-md flex items-center justify-between gap-3 px-4 sm:px-6 sticky top-0 z-40">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {/* Alleen zichtbaar onder `lg`: op een breed scherm staat de zijbalk altijd open en is
            er niets om open te klappen. Zie components/layout/sidebar-mobile-context.tsx. */}
        <button
          onClick={toggleSidebar}
          aria-label="Menu openen"
          className="-ml-1 shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-gray-100 lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h2 className="truncate text-lg font-bold text-rm-blue-ink">{getTitle()}</h2>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        {/* ── PLEK VOOR ACTIES VAN DE PAGINA ────────────────────────────────────
            Leeg gelaten voor knoppen die bij het huidige scherm horen maar in de chrome thuis
            zijn. Op dit moment vult alleen de sparrenknop hem, via een portal vanuit ChatDrawer.

            Waarom niet gewoon hier een knop: de bovenbalk staat in de root-layout en weet niets
            van welke klant er open is, terwijl de chatlade dat wel weet -- die hangt onder
            client-dashboard. Een portal laat de eigenaar van de toestand ook de eigenaar van de
            knop blijven, in plaats van de klantcontext door de layout te trekken.

            De id staat óók in chat-drawer.tsx. Verandert hij, dan valt de knop daar terug op zijn
            oude zwevende plek in plaats van te verdwijnen. */}
        <div id="topbalk-acties" className="flex items-center gap-2" />

        {/* Cmd+K/Ctrl+K quick-search (Fase 5). De knop is de ontdekbare ingang; de sneltoets werkt
            overal, ook zonder deze knop ooit aangeklikt te hebben (zie command-palette.tsx). */}
        <button
          onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
          className="hidden items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-meta text-muted-foreground transition-colors hover:bg-gray-100 sm:flex"
        >
          <Search className="h-3.5 w-3.5" />
          Zoeken
          <kbd className="ml-1 rounded border border-border bg-gray-50 px-1 text-micro">⌘K</kbd>
        </button>
        <CommandPalette />

        {/* De thema-keuze staat in de bovenbalk en niet weggestopt in de instellingen: het is een
            weergavevoorkeur van dit scherm, geen accountinstelling. */}
        <ThemaSchakelaar />

        {/* Notification bell */}
        {mounted && (
          <div className="relative" ref={panelRef}>
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <Bell className="w-5 h-5 text-muted-foreground" />
              {totalCount > 0 && (
                <span className={`absolute -top-0.5 -right-0.5 w-5 h-5 text-micro font-bold rounded-full flex items-center justify-center text-white ${
                  criticalCount > 0 ? "bg-red-500" : "bg-amber-500"
                }`}>
                  {totalCount > 9 ? "9+" : totalCount}
                </span>
              )}
            </button>

            {/* Dropdown */}
            {showNotifications && (
              <div className="absolute right-0 top-12 w-80 bg-card supports-[backdrop-filter]:bg-[var(--zweef-vlak)] supports-[backdrop-filter]:backdrop-blur-md rounded-xl border border-border shadow-lg overflow-hidden z-50">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <span className="text-sm font-semibold text-rm-blue-ink">Meldingen</span>
                  <button onClick={() => setShowNotifications(false)}>
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>
                {notifications.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                    Geen meldingen — alles ziet er goed uit.
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto divide-y divide-border">
                    {notifications.map((n, i) => (
                      <a
                        key={i}
                        href={n.clientId ? `/client/${n.clientId}` : "#"}
                        className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
                        onClick={() => setShowNotifications(false)}
                      >
                        {n.severity === "critical" ? (
                          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                        ) : n.severity === "warning" ? (
                          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                        ) : (
                          <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-rm-gray">{n.clientName}</p>
                          <p className="text-xs text-muted-foreground">{n.message}</p>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Verborgen onder `md`: samen met de titel, het meldingenbelletje, de thema-schakelaar
            en het gebruikersmenu paste de volle datum nergens meer onder ~480px -- de balk liep
            zelf al over zijn eigen breedte heen (zie sectie 13.2, docs/MASTERPLAN.md). De datum
            is de minst functionele van de balk (staat nergens anders, maar kost ook niemand een
            handeling als hij er even niet is), dus die gaat als eerste. */}
        <span className="hidden text-sm text-muted-foreground md:inline">
          {mounted
            ? new Date().toLocaleDateString("nl-NL", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })
            : ""
          }
        </span>

        <UserMenu />
      </div>
    </header>
  );
}
