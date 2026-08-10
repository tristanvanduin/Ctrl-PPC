"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ListChecks, LayoutGrid, Settings, Terminal, Building2 } from "lucide-react";
import { getVisibleClients } from "@/lib/visible-clients";

// Fase 5, Task 2: Cmd+K/Ctrl+K quick-search. Er bestond nog geen command-palette in de app
// (geverifieerd: geen cmdk-achtig patroon in components/). Bewust zonder externe library --
// het zoekbereik is klein (een handvol pagina's + de zichtbare klantenlijst, die de sidebar ook
// al doorzoekt) en een eigen implementatie houdt de bundel klein en het gedrag voorspelbaar.

interface Item {
  id: string;
  label: string;
  sub?: string;
  href: string;
  icon: typeof Search;
}

function staticItems(): Item[] {
  return [
    { id: "vandaag", label: "Vandaag", sub: "Triagecockpit", href: "/vandaag", icon: ListChecks },
    { id: "portfolio", label: "Portfolio", sub: "Klantoverzicht", href: "/portfolio", icon: LayoutGrid },
    { id: "instellingen", label: "Instellingen", href: "/settings", icon: Settings },
    { id: "scripts", label: "Scripts", href: "/scripts", icon: Terminal },
  ];
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      // Volgende tick: het veld staat er dan al, autoFocus alleen mist soms de eerste render.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const items: Item[] = useMemo(() => {
    const clientItems: Item[] = getVisibleClients().map((c) => ({
      id: c.id,
      label: c.name,
      sub: "Klant",
      href: `/client/${c.id}`,
      icon: Building2,
    }));
    return [...staticItems(), ...clientItems];
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 8);
    return items.filter((i) => i.label.toLowerCase().includes(q) || i.sub?.toLowerCase().includes(q)).slice(0, 20);
  }, [items, query]);

  function ga(item: Item) {
    setOpen(false);
    router.push(item.href);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 pt-[15vh]" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Snel zoeken"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, filtered.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
              if (e.key === "Enter" && filtered[activeIdx]) ga(filtered[activeIdx]);
            }}
            placeholder="Zoek een pagina of klant..."
            className="flex-1 bg-transparent text-body text-rm-gray placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-micro text-muted-foreground">esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-1.5">
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-center text-meta text-muted-foreground">Niets gevonden voor &ldquo;{query}&rdquo;.</p>
          )}
          {filtered.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => ga(item)}
                onMouseEnter={() => setActiveIdx(i)}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left text-body transition-colors ${
                  i === activeIdx ? "bg-rm-blue/10 text-rm-blue-ink" : "text-rm-gray"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.sub && <span className="shrink-0 text-micro text-muted-foreground">{item.sub}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
