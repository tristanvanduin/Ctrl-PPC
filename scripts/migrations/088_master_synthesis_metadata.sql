-- 088: Master Synthesis (Pijler 6) metadata-kolommen. Additief en idempotent, zelfde patroon
-- als 010/011/021 (kolommen toevoegen aan een bestaande tabel, geen nieuwe tabel).
--
-- sprint_hypotheses en sprint_items dragen geen structured-metadata-kolom; de enige bestaande
-- precedent voor "extra structuur op een hypothese-rij" is het monthly-hypotheses-workflow-pad
-- (lib/analysis/monthly-hypotheses-insights.ts), dat een JSON-blob in rationale prefixt --
-- ongeschikt hier, want rationale draagt bij Master Synthesis de echte, leesbare onderbouwing
-- van het model en die mag niet overschreven worden met opake JSON.
--
-- metadata draagt bij Master Synthesis-rijen (source = 'master_synthesis'):
--   sprint_hypotheses.metadata: { contributing_channels: string[] }
--   sprint_items.metadata: { contributing_channels: string[], action_type, priority, frequency, due_date_days, source: "master_synthesis" }
-- Voor alle andere bronnen blijft metadata null; geen enkele bestaande schrijfweg wijzigt.

alter table sprint_hypotheses add column if not exists metadata jsonb;
alter table sprint_items add column if not exists metadata jsonb;
