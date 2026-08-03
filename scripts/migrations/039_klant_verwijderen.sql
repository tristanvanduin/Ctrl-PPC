-- 039: het recht om vergeten te worden — alle data van één klant, aantoonbaar volledig.
--
-- DRAAIEN: idempotent, veilig te herhalen. Maakt alleen twee functies aan; er wordt niets
-- verwijderd door deze migratie zelf.
--
-- ── WAAROM ──────────────────────────────────────────────────────────────────
--
-- Zodra dit als SaaS voor meerdere bureaus draait, is dit geen nette extra maar een harde eis.
-- Vertrekt een eindklant bij een bureau en eist die verwijdering van zijn gegevens, dan moet dat
-- kunnen — en moet je kunnen aantónen dat het gebeurd is.
--
-- Het gevaarlijke aan zo'n functie is niet dat hij te veel weggooit maar te weinig: een
-- verwijdering die 96 van de 99 tabellen raakt ziet er geslaagd uit en is het niet. Daarom drie
-- eigenschappen:
--
--   1. De tabellenlijst wordt bij elke aanroep opgehaald uit information_schema en staat niet
--      hardgecodeerd. Een tabel die morgen wordt toegevoegd met een client_id-kolom doet
--      automatisch mee. Een vaste lijst zou verouderen zonder dat iemand het merkt, en dat is
--      precies het soort stille onvolledigheid waar dit tegen moet beschermen.
--   2. Er is een inventarisatie die niets verwijdert. Eerst kijken wat er staat, dan pas wissen.
--   3. De verwijdering weigert zonder expliciete bevestiging, en rapporteert per tabel hoeveel
--      rijen er weg zijn. Dat rapport is het bewijs.
--
-- ── WAT ER NIET VANZELF IN ZIT ──────────────────────────────────────────────
--
-- Twee tabellen dragen klantdata zonder client_id-kolom en zouden door een generieke sweep
-- gemist worden:
--
--   generation_job_events   hangt via job_id aan generation_jobs.job_id (die wél client_id heeft;
--                           let op: de sleutel van generation_jobs heet job_id en niet id)
--   fact_core               hangt via account_id aan accounts
--
-- De eerste wordt hieronder expliciet meegenomen. De tweede gaat vanzelf mee door de
-- foreign key met `on delete cascade` op accounts, mits de accounts-rij als laatste wordt
-- verwijderd — vandaar de volgorde onderaan.
--
-- Gecontroleerd op het moment van schrijven: dat zijn de enige twee. De overige gevulde tabellen
-- zonder client_id (benchmark_sectors, scripts, app_settings, agencies, user_roles,
-- schema_migrations, linkedin_urn_labels) bevatten geen klantgebonden gegevens.

-- ── 1. Inventarisatie: wat staat er, zonder iets aan te raken ────────────────

create or replace function klant_data_inventaris(p_client_id text)
returns table (tabel text, rijen bigint)
language plpgsql
as $$
declare
  r record;
  aantal bigint;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join pg_tables t on t.tablename = c.table_name and t.schemaname = 'public'
    where c.table_schema = 'public' and c.column_name = 'client_id'
    order by c.table_name
  loop
    execute format('select count(*) from public.%I where client_id = $1', r.table_name)
      into aantal using p_client_id;
    if aantal > 0 then
      tabel := r.table_name; rijen := aantal; return next;
    end if;
  end loop;

  -- De twee die geen client_id hebben.
  execute 'select count(*) from generation_job_events e
           join generation_jobs j on j.job_id = e.job_id where j.client_id = $1'
    into aantal using p_client_id;
  if aantal > 0 then tabel := 'generation_job_events'; rijen := aantal; return next; end if;

  execute 'select count(*) from fact_core f
           join accounts a on a.id = f.account_id where a.client_id = $1'
    into aantal using p_client_id;
  if aantal > 0 then tabel := 'fact_core'; rijen := aantal; return next; end if;
end;
$$;

-- ── 2. Verwijderen ──────────────────────────────────────────────────────────

create or replace function verwijder_klant_data(p_client_id text, p_bevestig boolean default false)
returns table (tabel text, verwijderd bigint)
language plpgsql
as $$
declare
  r record;
  aantal bigint;
begin
  if not p_bevestig then
    raise exception 'verwijder_klant_data vereist p_bevestig := true. Draai eerst klant_data_inventaris(%) om te zien wat er weggaat.', p_client_id;
  end if;
  if p_client_id is null or btrim(p_client_id) = '' then
    raise exception 'geen client_id opgegeven';
  end if;

  -- Eerst de twee die aan een ander record hangen, vóórdat dat record verdwijnt.
  execute 'delete from generation_job_events e
           using generation_jobs j where j.job_id = e.job_id and j.client_id = $1'
    using p_client_id;
  get diagnostics aantal = row_count;
  if aantal > 0 then tabel := 'generation_job_events'; verwijderd := aantal; return next; end if;

  -- Dan alles met een eigen client_id, behalve accounts — die gaat als laatste, zodat de
  -- cascade naar fact_core pas afgaat als de rest weg is.
  for r in
    select c.table_name
    from information_schema.columns c
    join pg_tables t on t.tablename = c.table_name and t.schemaname = 'public'
    where c.table_schema = 'public' and c.column_name = 'client_id'
      and c.table_name <> 'accounts'
    order by c.table_name
  loop
    execute format('delete from public.%I where client_id = $1', r.table_name) using p_client_id;
    get diagnostics aantal = row_count;
    if aantal > 0 then tabel := r.table_name; verwijderd := aantal; return next; end if;
  end loop;

  -- fact_core hangt met on delete cascade aan accounts; tellen vóór het verwijderen, want
  -- daarna is er niets meer te tellen.
  execute 'select count(*) from fact_core f join accounts a on a.id = f.account_id
           where a.client_id = $1' into aantal using p_client_id;
  if aantal > 0 then tabel := 'fact_core (via accounts)'; verwijderd := aantal; return next; end if;

  delete from accounts where client_id = p_client_id;
  get diagnostics aantal = row_count;
  if aantal > 0 then tabel := 'accounts'; verwijderd := aantal; return next; end if;
end;
$$;

-- ── Controle ────────────────────────────────────────────────────────────────
-- De inventarisatie op een echte klant. Verwijdert niets.

select tabel, rijen from klant_data_inventaris('demo-greentech') order by rijen desc;
