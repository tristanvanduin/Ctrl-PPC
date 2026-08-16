-- 092: Fase 4 volgfix, gevonden via live verificatie tegen productie.
--
-- ── BUG ───────────────────────────────────────────────────────────────────
--
-- 091's hypothesis_id had `on delete cascade`. Een cascade-delete implementeert Postgres door
-- zelf DELETE-statements tegen de kindtabel (agency_memory_events) uit te voeren -- en de
-- append-only-trigger uit 091 (bedoeld om PER ONGELUK schrijven tegen te houden) weigert die
-- net zo hard als een handmatige DELETE. Gevolg: het verwijderen van een sprint_hypotheses-rij
-- met gekoppelde memory-events faalt altijd, met een verwarrende foutmelding op een tabel die
-- de aanroeper niet eens noemde. sprint_hypotheses staat in write-policy.ts met delete in zijn
-- toegestane operaties, dus dit is een echt bereikbaar pad, niet een theoretisch randgeval.
--
-- Live gevonden: een verificatiescript zaaide drie sprint_hypotheses-rijen met acht gekoppelde
-- memory-events, en de opruim-delete op die hypotheses faalde stil (fout niet gelogd door het
-- script), wat drie test-hypotheses en acht test-events in productie achterliet.
--
-- ── FIX, EN OOK DE JUISTERE SEMANTIEK ────────────────────────────────────────
--
-- `on delete set null` in plaats van cascade. Een memory-event is een historisch feit ("dit is
-- ooit voorgesteld/geaccepteerd/..."), dat niet hoort te verdwijnen alleen omdat de brondata
-- later wordt opgeruimd -- dat is precies wat "geheugen" in Fase 4's naam betekent. Cascade zou
-- het geheugen juist laten wissen door hetzelfde soort actie die het geheugen zou moeten
-- overleven.

alter table agency_memory_events drop constraint if exists agency_memory_events_hypothesis_id_fkey;
alter table agency_memory_events
  add constraint agency_memory_events_hypothesis_id_fkey
  foreign key (hypothesis_id) references sprint_hypotheses(id) on delete set null;

-- ── Opruiming van de wegwerpbare test-data die de bug blootlegde ────────────
--
-- client_id 'zztest-memory-events-verify', duidelijk gemarkeerd als verificatiedata (zie
-- scripts/tmp-verify-memory-events.ts). Append-only geldt voor het normale schrijfpad van de
-- applicatie; dit is een bewuste, eenmalige beheeractie om zelf veroorzaakte test-rommel weg te
-- halen, geen gewone DELETE -- de trigger gaat daarom expliciet en tijdelijk uit, en direct
-- daarna weer aan.
alter table agency_memory_events disable trigger agency_memory_events_geen_delete;
delete from agency_memory_events where client_id = 'zztest-memory-events-verify';
alter table agency_memory_events enable trigger agency_memory_events_geen_delete;

delete from sprint_hypotheses where client_id = 'zztest-memory-events-verify';
delete from accounts where client_id = 'zztest-memory-events-verify';
