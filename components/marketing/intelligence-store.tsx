"use client";

// The Intelligence Store: module add-ons and bundles below the tier grid on /pricing.
//
// Visual-only checkout simulation, as scoped: selecting a module or bundle adds it to a running
// total and surfaces the Floating Command Bar, but nothing here calls an API or charges anything.
// "Initialize Upgrade" links to /demo, same as every other CTA on this page - there is no
// self-serve Stripe flow in this codebase yet, and pretending there is one would be worse than
// not having it.
//
// Selecting a bundle deselects its constituent modules (and locks them, shown as "In bundle") so
// the running total never double-counts the same capability twice.

import { useMemo, useState } from "react";
import { Check, Clock, Sparkles } from "lucide-react";
import { MODULES, BUNDLES, moduleById, type StoreModule } from "@/lib/marketing/modules";

function ComingSoonTag() {
  return (
    <span className="rounded-[4px] border border-off-white/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-off-white/40">
      Coming soon
    </span>
  );
}

function ModuleCard({
  mod,
  selected,
  lockedByBundle,
  godViewTier,
  onToggle,
  onSelectGodViewTier,
}: {
  mod: StoreModule;
  selected: boolean;
  lockedByBundle: boolean;
  godViewTier: number | null;
  onToggle: () => void;
  onSelectGodViewTier: (tierIndex: number | null) => void;
}) {
  const isVariantModule = Array.isArray(mod.prijs);
  const isDynamic = !isVariantModule && mod.prijs === 0;

  return (
    <div
      className={`flex flex-col rounded-[6px] border p-5 backdrop-blur-sm transition-colors ${
        selected || godViewTier !== null
          ? "border-neon-indigo/50 bg-midnight-slate-raised/80"
          : "border-off-white/10 bg-midnight-slate-raised/50 hover:border-neon-indigo/30"
      } hover:shadow-[0_0_28px_rgba(129,140,248,0.12)]`}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-marketing-heading text-sm font-bold text-off-white">{mod.naam}</h4>
        {!mod.gebouwd && <ComingSoonTag />}
      </div>
      <p className="mt-1.5 flex-1 text-xs leading-relaxed text-off-white/50">{mod.omschrijving}</p>

      {isVariantModule && (
        <div className="mt-3 space-y-1.5">
          {(mod.prijs as { naam: string; prijsPerMaand: number }[]).map((t, i) => (
            <button
              key={t.naam}
              type="button"
              onClick={() => onSelectGodViewTier(godViewTier === i ? null : i)}
              className={`flex w-full items-center justify-between rounded-[4px] border px-2.5 py-1.5 text-xs transition-colors ${
                godViewTier === i
                  ? "border-neon-indigo/50 bg-neon-indigo/10 text-neon-indigo"
                  : "border-off-white/10 text-off-white/60 hover:border-off-white/25"
              }`}
            >
              <span>{t.naam}</span>
              <span className="font-semibold">{"€"}{t.prijsPerMaand.toLocaleString("en-US")}/mo</span>
            </button>
          ))}
        </div>
      )}

      {!isVariantModule && !isDynamic && (
        <div className="mt-3 flex items-center justify-between">
          <span className="font-marketing-heading text-lg font-bold text-off-white">
            {"€"}{(mod.prijs as number).toLocaleString("en-US")}
            <span className="ml-1 text-xs font-normal text-off-white/50">/mo</span>
          </span>
          <button
            type="button"
            onClick={onToggle}
            disabled={lockedByBundle}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              selected
                ? "border-neon-indigo bg-neon-indigo text-midnight-slate"
                : "border-off-white/20 text-off-white/50 hover:border-neon-indigo hover:text-neon-indigo"
            }`}
            aria-pressed={selected}
            aria-label={selected ? `Remove ${mod.naam}` : `Add ${mod.naam}`}
          >
            {selected ? <Check className="h-3.5 w-3.5" aria-hidden /> : <span className="text-sm leading-none">+</span>}
          </button>
        </div>
      )}
      {lockedByBundle && <p className="mt-2 text-[10px] uppercase tracking-wide text-neon-indigo/70">In bundle</p>}

      {isDynamic && (
        <div className="mt-3">
          <a
            href="/demo"
            className="block rounded-[4px] border border-off-white/15 px-3 py-1.5 text-center text-xs font-semibold text-off-white/70 transition-colors hover:border-neon-indigo hover:text-neon-indigo"
          >
            Configure
          </a>
        </div>
      )}
    </div>
  );
}

export function IntelligenceStore() {
  const [selectedModuleIds, setSelectedModuleIds] = useState<Set<string>>(new Set());
  const [godViewTier, setGodViewTier] = useState<number | null>(null);
  const [selectedBundleIds, setSelectedBundleIds] = useState<Set<string>>(new Set());

  const lockedModuleIds = useMemo(() => {
    const locked = new Set<string>();
    for (const bundleId of selectedBundleIds) {
      const bundle = BUNDLES.find((b) => b.id === bundleId);
      bundle?.moduleIds.forEach((id) => locked.add(id));
    }
    return locked;
  }, [selectedBundleIds]);

  function toggleModule(id: string) {
    setSelectedModuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleBundle(bundleId: string) {
    setSelectedBundleIds((prev) => {
      const next = new Set(prev);
      if (next.has(bundleId)) {
        next.delete(bundleId);
      } else {
        next.add(bundleId);
        const bundle = BUNDLES.find((b) => b.id === bundleId);
        setSelectedModuleIds((mods) => {
          const cleared = new Set(mods);
          bundle?.moduleIds.forEach((id) => cleared.delete(id));
          return cleared;
        });
      }
      return next;
    });
  }

  const { count, total } = useMemo(() => {
    let c = 0;
    let t = 0;
    for (const id of selectedModuleIds) {
      const mod = moduleById(id);
      if (mod && typeof mod.prijs === "number") { c++; t += mod.prijs; }
    }
    if (godViewTier !== null) {
      const godView = moduleById("god-view");
      const tier = Array.isArray(godView?.prijs) ? godView.prijs[godViewTier] : null;
      if (tier) { c++; t += tier.prijsPerMaand; }
    }
    for (const id of selectedBundleIds) {
      const bundle = BUNDLES.find((b) => b.id === id);
      if (bundle) { c++; t += bundle.prijsPerMaand; }
    }
    return { count: c, total: t };
  }, [selectedModuleIds, godViewTier, selectedBundleIds]);

  return (
    <div className="mt-20">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-neon-indigo">The Intelligence Store</p>
        <h2 className="mt-3 font-marketing-heading text-2xl font-bold text-off-white sm:text-3xl">
          Modules and bundles
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-off-white/50">
          Expand any tier with individual modules, or take a bundle at a lower combined rate.
        </p>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {MODULES.map((mod) => (
          <ModuleCard
            key={mod.id}
            mod={mod}
            selected={selectedModuleIds.has(mod.id)}
            lockedByBundle={lockedModuleIds.has(mod.id)}
            godViewTier={mod.id === "god-view" ? godViewTier : null}
            onToggle={() => toggleModule(mod.id)}
            onSelectGodViewTier={setGodViewTier}
          />
        ))}
      </div>

      <div className="mt-10">
        <p className="mb-4 text-center text-xs font-semibold uppercase tracking-[0.2em] text-off-white/40">
          Smart bundles
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {BUNDLES.map((bundle) => {
            const modules = bundle.moduleIds.map((id) => moduleById(id)).filter((m): m is StoreModule => !!m);
            const individualTotal = modules.reduce((s, m) => s + (typeof m.prijs === "number" ? m.prijs : 0), 0);
            const savings = individualTotal - bundle.prijsPerMaand;
            const allBuilt = modules.every((m) => m.gebouwd);
            const active = selectedBundleIds.has(bundle.id);
            return (
              <div
                key={bundle.id}
                className={`flex flex-col rounded-[6px] border p-5 backdrop-blur-sm transition-colors ${
                  active
                    ? "border-neon-indigo/50 bg-midnight-slate-raised/80"
                    : "border-copper/30 bg-copper/5 hover:border-neon-indigo/40"
                } hover:shadow-[0_0_28px_rgba(129,140,248,0.12)]`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-copper" aria-hidden />
                    <h4 className="font-marketing-heading text-sm font-bold text-off-white">{bundle.naam}</h4>
                  </div>
                  {!allBuilt && <ComingSoonTag />}
                </div>
                <p className="mt-1.5 text-xs text-off-white/50">{bundle.focus}</p>
                <p className="mt-2 text-xs text-off-white/40">
                  {modules.map((m) => m.naam).join(" + ")}
                </p>

                <div className="mt-4 flex items-center justify-between">
                  <div>
                    <span className="font-marketing-heading text-lg font-bold text-off-white">
                      {"€"}{bundle.prijsPerMaand.toLocaleString("en-US")}
                      <span className="ml-1 text-xs font-normal text-off-white/50">/mo</span>
                    </span>
                    {savings > 0 && (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-copper">
                        Save {"€"}{savings}/mo
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleBundle(bundle.id)}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
                      active
                        ? "border-neon-indigo bg-neon-indigo text-midnight-slate"
                        : "border-off-white/20 text-off-white/50 hover:border-neon-indigo hover:text-neon-indigo"
                    }`}
                    aria-pressed={active}
                    aria-label={active ? `Remove ${bundle.naam}` : `Add ${bundle.naam}`}
                  >
                    {active ? <Check className="h-3.5 w-3.5" aria-hidden /> : <span className="text-sm leading-none">+</span>}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div
            className="flex w-full max-w-lg items-center justify-between gap-4 rounded-[6px] border border-neon-indigo/40 bg-midnight-slate/95 px-5 py-3 backdrop-blur-md"
            style={{ boxShadow: "0 0 40px rgba(129, 140, 248, 0.25)" }}
          >
            <div className="flex items-center gap-2 text-xs text-off-white/70" style={{ fontFamily: "var(--font-marketing-mono)" }}>
              <Clock className="h-3.5 w-3.5 shrink-0 text-neon-indigo" aria-hidden />
              <span>
                {count} {count === 1 ? "modification" : "modifications"} queued
                <span className="mx-2 text-off-white/30">|</span>
                <span className="font-semibold text-neon-indigo">+{"€"}{total.toLocaleString("en-US")}/mo</span>
              </span>
            </div>
            <a
              href="/demo"
              className="shrink-0 rounded-[6px] px-4 py-2 text-xs font-semibold text-midnight-slate transition-transform hover:scale-[1.02]"
              style={{ backgroundColor: "#818cf8" }}
            >
              Initialize Upgrade
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
