// De eerste implementatie van HypothesisDiscovery (het contract staat in hypothesis-discovery.ts).
// Elk getriggerd signaal wordt een kandidaat-hypothese: de omschrijving van het signaal is al een
// leesbare bewering (google-provider.ts: scope + story + actionDirection), dus die tekst wordt de
// statement, ongewijzigd.
//
// CATEGORIE: discovery classificeert niet zelf op tekst (dat doet classify(), erna), maar een
// categorie die de DETECTOR al kende reist wel mee. Herbouw 2 september 2026: het enige
// productiesignaal (schedule_waste, categorie budget_pacing) verloor zijn categorie onderweg en
// classify() vond in de verhaaltekst geen enkel trefwoord -- elke hypothese kwam als null binnen.
// Een categorie die er al was weggooien en dan proberen te raden is geen "open discovery", dat
// is informatie vernietigen.
//
// causes en context zijn vandaag altijd leeg/undefined: er bestaat geen CandidateCause-producent
// en geen ContextEngine-implementatie. causes wordt wel meegenomen als hij iets bevat, zodat deze
// discovery niet stiekem aanneemt dat signals de enige bron is.

import type { SignalCategory } from "@/lib/signals/types";
import type { HypothesisDiscovery, HypothesisCategory } from "./hypothesis-discovery";
import type { Hypothesis } from "./types";

/** Detectorcategorie → gesloten hypothese-categorie. Wat hier niet in staat (cross_channel)
 *  krijgt geen tag; classify() valt dan terug op de tekst. */
export const SIGNAAL_NAAR_HYPOTHESE_CATEGORIE: Partial<Record<SignalCategory, HypothesisCategory>> = {
  budget_pacing: "budget",
  veiling_concurrentie: "budget",
  creative: "creative",
  conversie_meting: "tracking",
  zoektermen_intentie: "search",
  kwaliteit: "search",
  zichtbaarheid_vraag: "opportunity",
};

export const signalHypothesisDiscovery: HypothesisDiscovery = {
  discover({ agencyId, accountId, signals, causes }) {
    const uitSignalen: Hypothesis[] = signals.map((signal) => {
      const categorie = signal.category ? SIGNAAL_NAAR_HYPOTHESE_CATEGORIE[signal.category] : undefined;
      return {
        id: crypto.randomUUID(),
        agencyId,
        accountId,
        statement: signal.description,
        ...(categorie ? { category: categorie } : {}),
      };
    });
    const uitOorzaken: Hypothesis[] = causes.map((cause) => ({
      id: crypto.randomUUID(),
      agencyId,
      accountId,
      statement: cause.description,
    }));
    return [...uitSignalen, ...uitOorzaken];
  },
};
