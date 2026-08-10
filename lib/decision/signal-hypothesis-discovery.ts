// Fase 2: de eerste implementatie van HypothesisDiscovery (het contract staat in
// hypothesis-discovery.ts). Elk getriggerd signaal wordt een kandidaat-hypothese: de
// omschrijving van het signaal is al een leesbare bewering (zie google-provider.ts:
// "story" + "actionDirection" samen), dus die tekst wordt de statement, ongewijzigd.
//
// category BLIJFT ONGEZET. Dat is met opzet: discovery is open, classify() draait er apart NA
// (zie de kop van hypothesis-discovery.ts). Deze functie classificeert dus zelf niets.
//
// causes en context zijn vandaag altijd leeg/undefined: er bestaat geen CandidateCause-
// producent en geen ContextEngine-implementatie (Stap 5, nog steeds wees). causes wordt hier wel
// meegenomen als hij iets bevat, zodat deze discovery niet stiekem aanneemt dat signals de enige
// bron is -- maar er wordt niets verzonnen zolang hij leeg blijft.

import type { HypothesisDiscovery } from "./hypothesis-discovery";
import type { Hypothesis } from "./types";

export const signalHypothesisDiscovery: HypothesisDiscovery = {
  discover({ agencyId, accountId, signals, causes }) {
    const uitSignalen: Hypothesis[] = signals.map((signal) => ({
      id: crypto.randomUUID(),
      agencyId,
      accountId,
      statement: signal.description,
    }));
    const uitOorzaken: Hypothesis[] = causes.map((cause) => ({
      id: crypto.randomUUID(),
      agencyId,
      accountId,
      statement: cause.description,
    }));
    return [...uitSignalen, ...uitOorzaken];
  },
};
