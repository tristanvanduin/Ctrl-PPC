// De Meta Graph/Marketing API-versie, op één plek.
//
// WAAROM APART: er stonden twee versieconstanten in de codebase — lib/meta/sync.ts op v25.0 en
// lib/api/meta-ads.ts op v21.0 — en die zijn uit elkaar gelopen zonder dat iets dat opmerkte.
// Dat is precies het soort verschil dat pas opvalt als een klant belt: de sync praat tegen een
// ondersteunde versie en het koppelscherm tegen een uitgezette.
//
// WAAROM HET DRINGEND WAS: Meta zet oude Marketing API-versies hard uit, en per 9 juni 2026 is
// v24.0 de oudste die nog werkt. v21.0 lag daar zeven weken achter. Meta tilt verouderde calls
// soms automatisch naar de eerstvolgende versie, maar dat geldt niet per endpoint en is geen
// vangnet om op te bouwen.
//
// BIJ EEN VOLGENDE UPGRADE: loop de changelog na op twee dingen die deze codebase raken — de
// views-metriek die reach vervangt, en de Advantage+-velden die read-only zijn geworden. De
// 7- en 28-daagse view-attributievensters zijn in januari 2026 geschrapt; we vragen geen
// expliciete attributievensters op, dus daar zit geen afhankelijkheid.
//
// LET OP: breakdowns bewaart Meta nog 13 maanden. lib/meta/sync-windows.ts staat daar al op
// afgestemd (backfillWindow default 13); rek dat venster niet op zonder dat te controleren.

export const META_API_VERSION = "v25.0";

export const META_GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;
