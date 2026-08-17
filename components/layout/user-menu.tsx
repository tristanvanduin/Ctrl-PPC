"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserCircle2, Settings, LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";

// Fase 5, Task 2: het gebruikersmenu in de bovenbalk. E-mail via /api/me -- hetzelfde,
// bewust lichte patroon dat lib/feed/use-today-feed.ts al gebruikt (geen sessie/enforcement:
// gewoon geen e-mail, geen foutmelding).

export function UserMenu() {
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => setEmail(d?.email ?? null)).catch(() => {});
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function logout() {
    if (supabase) await supabase.auth.signOut();
    setOpen(false);
    router.push("/login");
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-gray-100"
        title={email ?? "Account"}
      >
        <UserCircle2 className="h-5 w-5" />
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-56 overflow-hidden rounded-xl border border-border bg-card shadow-lg supports-[backdrop-filter]:bg-[var(--zweef-vlak)] supports-[backdrop-filter]:backdrop-blur-md">
          <div className="border-b border-border px-4 py-3">
            <p className="truncate text-meta font-medium text-brand-gray">{email ?? "Niet ingelogd"}</p>
          </div>
          <a
            href="/settings"
            className="flex items-center gap-2 px-4 py-2.5 text-body text-brand-gray hover:bg-gray-50"
            onClick={() => setOpen(false)}
          >
            <Settings className="h-3.5 w-3.5 text-muted-foreground" />
            Instellingen
          </a>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-body text-red-600 hover:bg-red-50"
          >
            <LogOut className="h-3.5 w-3.5" />
            Uitloggen
          </button>
        </div>
      )}
    </div>
  );
}
