-- 094: de GA4-configuratiekolom die client_settings tot nu toe niet had. lib/ga4/data-access.ts
-- las hem al ("client_settings.ga4_config"), maar de kolom bestond niet eens in productie -- zie
-- lib/marketing/tiers.ts se opmerking na live verificatie op 16 augustus. Zonder deze migratie
-- geeft elke GA4-config-lookup een databasefout, geen "absent" -- dat is precies het verschil
-- tussen "GA4 is niet gekoppeld" en "GA4 is stuk", en de doctrine (lib/ga4/data-access.ts) staat
-- alleen het eerste toe.
--
-- Vorm: { "propertyId": "properties/123456789", "keyEvents": ["form_submit","generate_lead"],
--         "funnelSteps": ["session_start","view_item","form_start","form_submit"] }
-- Zie lib/ga4/types.ts (Ga4Config) voor de canonieke vorm; parseConfig in data-access.ts valideert
-- bij het lezen en behandelt een onvolledige/foutieve waarde als "niet geconfigureerd", niet als
-- fout.

alter table client_settings add column if not exists ga4_config jsonb;

comment on column client_settings.ga4_config is
  'GA4-koppeling per klant: {propertyId, keyEvents[], funnelSteps[]}. Leeg/ontbrekend = GA4 draait niet mee (lib/ga4 geeft "absent" terug, geen platformconclusie wordt overschreven).';
