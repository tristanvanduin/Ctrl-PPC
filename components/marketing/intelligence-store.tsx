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

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Clock, Info, Sparkles, X } from "lucide-react";
import { MODULES, BUNDLES, moduleById, type StoreModule, type ModulePriceTier } from "@/lib/marketing/modules";
import { ComingSoonBadge } from "./coming-soon-badge";

function ModuleInfoPopover({ mod, onReadMore, onClose }: { mod: StoreModule; onReadMore: () => void; onClose: () => void }) {
  return (
    <>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default"
      />
      <div
        role="dialog"
        aria-label={`${mod.naam} summary`}
        className="absolute left-0 top-full z-50 mt-2 w-64 rounded-[6px] border border-off-white/15 bg-midnight-slate p-3 shadow-[0_8px_30px_rgba(0,0,0,0.4)]"
      >
        <p className="text-xs leading-relaxed text-off-white/70">{mod.omschrijving}</p>
        <button
          type="button"
          onClick={onReadMore}
          className="mt-2 text-xs font-semibold text-neon-indigo hover:underline"
        >
          Read more
        </button>
      </div>
    </>
  );
}

function ModuleCard({
  mod,
  selected,
  lockedByBundle,
  godViewTier,
  infoOpen,
  onToggle,
  onSelectGodViewTier,
  onToggleInfo,
  onReadMore,
}: {
  mod: StoreModule;
  selected: boolean;
  lockedByBundle: boolean;
  godViewTier: number | null;
  infoOpen: boolean;
  onToggle: () => void;
  onSelectGodViewTier: (tierIndex: number | null) => void;
  onToggleInfo: () => void;
  onReadMore: () => void;
}) {
  const isVariantModule = Array.isArray(mod.prijs);
  const isDynamic = !isVariantModule && mod.prijs === 0;

  return (
    <div
      className={`relative flex flex-col rounded-[6px] border p-5 backdrop-blur-sm transition-colors ${
        selected || godViewTier !== null
          ? "border-neon-indigo/50 bg-midnight-slate-raised/80"
          : "border-off-white/10 bg-midnight-slate-raised/50 hover:border-neon-indigo/30"
      } hover:shadow-[0_0_28px_rgba(129,140,248,0.12)]`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="relative flex items-center gap-1.5">
          <h4 className="font-marketing-heading text-sm font-bold text-off-white">{mod.naam}</h4>
          <button
            type="button"
            onClick={onToggleInfo}
            aria-label={`About ${mod.naam}`}
            aria-expanded={infoOpen}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-off-white/40 transition-colors hover:text-neon-indigo"
          >
            <Info className="h-3.5 w-3.5" aria-hidden />
          </button>
          {infoOpen && <ModuleInfoPopover mod={mod} onReadMore={onReadMore} onClose={onToggleInfo} />}
        </div>
        {!mod.gebouwd && <ComingSoonBadge />}
      </div>
      <p className="mt-1.5 flex-1 text-xs leading-relaxed text-off-white/50">{mod.omschrijving}</p>

      {isVariantModule && (
        <div className="mt-3 space-y-1.5">
          {(mod.prijs as ModulePriceTier[]).map((t, i) => (
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
              <span className="flex flex-col items-start">
                <span>{t.naam}</span>
                <span className={`text-[10px] ${godViewTier === i ? "text-neon-indigo/70" : "text-off-white/35"}`}>{t.tagline}</span>
              </span>
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
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[4px] border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              selected
                ? "border-neon-indigo bg-neon-indigo text-midnight-slate"
                : "border-off-white/20 text-off-white/50 hover:border-neon-indigo hover:text-neon-indigo"
            }`}
            aria-pressed={selected}
            aria-label={selected ? `Remove ${mod.naam}` : `Add ${mod.naam}`}
          >
            {selected ? <Check className="h-4 w-4" aria-hidden /> : <span className="text-base leading-none">+</span>}
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
  const [open, setOpen] = useState(false);
  const [selectedModuleIds, setSelectedModuleIds] = useState<Set<string>>(new Set());
  const [godViewTier, setGodViewTier] = useState<number | null>(null);
  const [selectedBundleIds, setSelectedBundleIds] = useState<Set<string>>(new Set());
  const [infoOpenId, setInfoOpenId] = useState<string | null>(null);
  const [detailModuleId, setDetailModuleId] = useState<string | null>(null);
  const detailModule = detailModuleId ? moduleById(detailModuleId) : undefined;

  useEffect(() => {
    if (!detailModuleId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDetailModuleId(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailModuleId]);

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
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mx-auto mt-5 flex items-center gap-1.5 rounded-[6px] border border-off-white/15 px-4 py-2.5 text-xs font-semibold text-off-white/70 transition-colors hover:border-neon-indigo hover:text-neon-indigo"
        >
          {open ? "Hide modules & bundles" : "Explore modules & bundles"}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
      </div>

      {open && (
      <>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {MODULES.map((mod) => (
          <ModuleCard
            key={mod.id}
            mod={mod}
            selected={selectedModuleIds.has(mod.id)}
            lockedByBundle={lockedModuleIds.has(mod.id)}
            godViewTier={mod.id === "god-view" ? godViewTier : null}
            infoOpen={infoOpenId === mod.id}
            onToggle={() => toggleModule(mod.id)}
            onSelectGodViewTier={setGodViewTier}
            onToggleInfo={() => setInfoOpenId((cur) => (cur === mod.id ? null : mod.id))}
            onReadMore={() => {
              setInfoOpenId(null);
              setDetailModuleId(mod.id);
            }}
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
                  {!allBuilt && <ComingSoonBadge />}
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
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
                      active
                        ? "border-neon-indigo bg-neon-indigo text-midnight-slate"
                        : "border-off-white/20 text-off-white/50 hover:border-neon-indigo hover:text-neon-indigo"
                    }`}
                    aria-pressed={active}
                    aria-label={active ? `Remove ${bundle.naam}` : `Add ${bundle.naam}`}
                  >
                    {active ? <Check className="h-4 w-4" aria-hidden /> : <span className="text-base leading-none">+</span>}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      </>
      )}

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

      {detailModule && (
        <div className="fixed inset-0 z-[60]">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setDetailModuleId(null)}
            className="absolute inset-0 bg-midnight-slate/70 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${detailModule.naam} details`}
            className="absolute inset-y-0 right-0 flex w-full max-w-md translate-x-0 flex-col overflow-y-auto border-l border-off-white/10 bg-midnight-slate p-6 shadow-[0_0_60px_rgba(0,0,0,0.5)] duration-300 animate-in slide-in-from-right"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-marketing-heading text-lg font-bold text-off-white">{detailModule.naam}</h3>
              <button
                type="button"
                onClick={() => setDetailModuleId(null)}
                aria-label="Close"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-off-white/50 transition-colors hover:bg-off-white/10 hover:text-off-white"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            {!detailModule.gebouwd && <div className="mt-3 self-start"><ComingSoonBadge /></div>}
            <p className="mt-4 text-sm leading-relaxed text-off-white/70">{detailModule.detail}</p>

            {Array.isArray(detailModule.prijs) && (
              <div className="mt-5 space-y-4 border-t border-off-white/10 pt-5">
                {(detailModule.prijs as ModulePriceTier[]).map((t) => (
                  <div key={t.naam}>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-bold text-off-white">
                        {t.naam} <span className="font-normal text-off-white/40">- {t.tagline}</span>
                      </p>
                      <p className="shrink-0 text-xs font-semibold text-neon-indigo">
                        {"€"}{t.prijsPerMaand.toLocaleString("en-US")}/mo
                      </p>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-off-white/60">{t.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
