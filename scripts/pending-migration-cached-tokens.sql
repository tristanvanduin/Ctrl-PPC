-- Gecachte prompttokens per LLM-call vastleggen.
--
-- De provider (Gemini) cachet impliciet op een gedeeld promptbegin en rekent die tokens tegen
-- een kwart van het normale invoertarief af. De korting zit al verwerkt in cost_eur, maar het
-- aantal zelf wordt nu nergens bewaard. Zonder dat getal is achteraf niet te zien of de cache
-- werkte, en dat is precies wat je wilt kunnen zien: als een wijziging het gedeelde promptbegin
-- breekt, gaat er niets kapot maar wordt elke stap weer vol afgerekend.
--
-- Draaien wanneer je bij de database kunt. Tot die tijd blijft de insert werken zonder deze
-- kolom — lib/analysis/o2-targets-cost.ts schrijft hem bewust nog niet weg.

ALTER TABLE llm_usage
  ADD COLUMN IF NOT EXISTS cached_prompt_tokens integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN llm_usage.cached_prompt_tokens IS
  'Deel van prompt_tokens dat de provider uit zijn cache haalde. Afgerekend tegen een kwart van het invoertarief.';

-- Na deze migratie kan het veld mee in buildUsageRow (zie de opmerking daar).
