-- 105: voorstellen die onder "analysis" achterbleven terug naar hun eigen bron.
--
-- ── WAT ER GEBEURD IS ────────────────────────────────────────────────────────
--
-- Tot de voorstellen-splitsing schreven alle zes de weekly-/bi-weekly-varianten hun voorstellen
-- onder source "analysis" -- de bron van de MAANDpijplijn. Sindsdien draagt elke variant zijn
-- eigen sop_type als bron (proposalSourceForSopType in lib/second-opinion/findings-to-hypotheses.ts).
-- Wat vóór die splitsing is weggeschreven, staat er nog met het oude label.
--
-- Dat label is niet cosmetisch. Twee lezers gaan erdoor mis:
--
--   components/insights/proposal-queue.tsx sluit "analysis" expliciet uit (EXCLUDED_SOURCES) --
--   de maand heeft zijn eigen workflow-block. Een weekly-voorstel met dat label verschijnt dus
--   in geen enkele wachtrij.
--
--   app/api/insights/monthly-hypotheses/route.ts matcht op (client_id, analysis_id, hypothesis).
--   Deze rijen hebben geen analysis_id, dus daar landen ze ook niet.
--
-- Onzichtbaar aan beide kanten, terwijl het echte voorstellen zijn.
--
-- ── WAAROM HERSTELLEN EN NIET VERWIJDEREN ────────────────────────────────────
--
-- "Wees" betekent hier: verkeerd geëtiketteerd, niet waardeloos. De rij draagt een volledige
-- hypothese met ICE-score uit een analyse die echt gedraaid heeft. Zet je de bron recht, dan
-- verschijnt hij alsnog in de wachtrij en vervangt de eerstvolgende run van diezelfde variant
-- hem netjes via saveProposalsReplacingPending -- precies het gedrag dat de splitsing beoogde.
-- Verwijderen zou een echt voorstel weggooien om een labelfout op te lossen.
--
-- ── WAT DEZE MIGRATIE RAAKT ──────────────────────────────────────────────────
--
-- Gemeten op deze database, source = 'analysis':
--
--   status      echte sop_type   rijen
--   pending     monthly            84   <-- correct gelabeld, blijft ongemoeid
--   pending     biweekly            1   <-- deze
--   accepted    monthly/onbekend   27   <-- genomen beslissing, nooit aanraken
--   completed   onbekend            4   <-- idem
--   rejected    monthly             5   <-- idem
--
-- Eén rij dus, op demo-greentech. Dat is de uitkomst van de meting en niet de reden om het niet
-- te doen: de vraag was of er wezen lagen, en het antwoord moet uit een query komen en niet uit
-- een aanname. De migratie is geschreven op de VORM van het probleem, niet op die ene rij --
-- draait hij op een database waar de zes varianten wél vaak hebben gelopen, dan herstelt hij ze
-- allemaal.
--
-- ── DE AFLEIDING ─────────────────────────────────────────────────────────────
--
-- De echte sop_type komt uit sop_recommendations: extract-structured.ts schrijft de aanbeveling
-- en het voorstel in dezelfde run uit dezelfde `recs`-array, dus de hypothesetekst is identiek
-- en sop_recommendations draagt wél een sop_type.
--
-- Drie remmen, want een tekstmatch is een afleiding en geen sleutel:
--
--   1. alleen status = 'pending'. Accepted, rejected en completed zijn genomen beslissingen;
--      die blijven staan, hoe ze ook gelabeld zijn.
--   2. alleen waar de tekst naar precies EEN sop_type wijst. Wijst hij naar meer, dan is de
--      afleiding niet betrouwbaar en blijft de rij zoals hij is.
--   3. alleen naar de zes bekende varianten. Een onverwachte waarde in sop_type blijft staan en
--      dus zichtbaar, in plaats van stil een onbekende bron te worden.
--
-- Idempotent: na afloop is source niet meer 'analysis', dus een tweede run raakt niets.

with kandidaat as (
  select sh.id as hypothese_id,
         min(sr.sop_type) as sop_type,
         count(distinct sr.sop_type) as aantal_types
  from sprint_hypotheses sh
  join sop_recommendations sr
    on sr.client_id = sh.client_id
   and sr.hypothesis = sh.hypothesis
  where sh.source = 'analysis'
    and sh.status = 'pending'
  group by sh.id
),
te_herstellen as (
  select hypothese_id, sop_type
  from kandidaat
  where aantal_types = 1
    and sop_type in ('weekly', 'meta_weekly', 'linkedin_weekly',
                     'biweekly', 'meta_biweekly', 'linkedin_biweekly')
)
update sprint_hypotheses sh
set source = t.sop_type
from te_herstellen t
where sh.id = t.hypothese_id;
