-- 095: Search Console-configuratie per klant. Spiegelt 094 (ga4_config) qua vorm en qua doctrine
-- -- leeg/ontbrekend betekent "GSC draait niet mee", nooit een fout.
--
-- Vorm: { "siteUrl": "https://www.klant.nl/", "brandTerms": ["klantnaam","klant bv"] }
--
-- brandTerms is met OPZET een apart, door het bureau ingevoerd veld en NOOIT afgeleid uit
-- Ads-campagnenamen (BRAND_NAME_RE in app/api/analysis/cross-channel/route.ts) -- de hele waarde
-- van de merk-cannibalisatie-detector (MASTERPLAN sectie 5.6.0/5.6.2) is dat Search Console een
-- ONAFHANKELIJKE bron is naast die naamgevings-heuristiek. Zou brandTerms uit diezelfde
-- campagnenamen worden afgeleid, dan is het dezelfde gok twee keer, niet een verificatie.

alter table client_settings add column if not exists search_console_config jsonb;

comment on column client_settings.search_console_config is
  'Search Console-koppeling per klant: {siteUrl, brandTerms[]}. brandTerms is handmatige invoer van het bureau, nooit afgeleid uit Ads-campagnenamen. Leeg/ontbrekend = GSC draait niet mee.';
