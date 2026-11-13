#!/usr/bin/env bash
# W1.5 (Z2): dagelijkse dump van het public schema plus manifest, gecomprimeerd en
# client-side versleuteld. LIVE-ONGETEST: vergt DATABASE_URL, GPG_RECIPIENT en het
# upload-doel uit secrets-beheer. No-go: nooit een onversleutelde dump buiten productie,
# nooit secrets in de repo. De bestaande backup-guide zat niet in de codebase; deze
# scripts volgen standaard pg_dump-conventies en moeten met de guide verzoend worden.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL vereist}"
: "${GPG_RECIPIENT:?GPG_RECIPIENT vereist}"

SHA="$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
DATE="$(date -u +%Y-%m-%d)"
BASE="backup_${DATE}_${SHA}"
WORK="$(mktemp -d)"
CORE_TABLES=(ads_account_monthly ads_campaign_monthly ads_keyword_performance_monthly ads_search_terms_monthly generation_jobs)

# 1. Dump van het public schema
pg_dump "$DATABASE_URL" --schema=public --no-owner --no-privileges > "$WORK/${BASE}.sql"

# 2. Manifest: rijaantallen van de kerntabellen op dump-moment (voor de restore-assertions)
{
  echo "{"
  for i in "${!CORE_TABLES[@]}"; do
    t="${CORE_TABLES[$i]}"
    c="$(psql "$DATABASE_URL" -tAc "select count(*) from ${t}")"
    sep=","; [ "$i" -eq $(( ${#CORE_TABLES[@]} - 1 )) ] && sep=""
    echo "  \"${t}\": ${c}${sep}"
  done
  echo "}"
} > "$WORK/${BASE}.manifest.json"

# 3. Comprimeren en versleutelen
gzip "$WORK/${BASE}.sql"
gpg --batch --yes --encrypt --recipient "$GPG_RECIPIENT" --output "$WORK/${BASE}.sql.gz.gpg" "$WORK/${BASE}.sql.gz"

echo "Dump klaar: ${BASE}.sql.gz.gpg plus ${BASE}.manifest.json in ${WORK}"

# Zonder upload verdwijnt de dump met de runner, en dan is er geen back-up. Een eerdere versie
# eindigde hier met 0, en met de secrets ingericht stond de workflow dan elke nacht groen terwijl
# er niets terug te halen was (doorlichting 13 november). Tot stap 4 gebouwd is, faalt dit script
# hier hardop: een groene back-up die niets bewaart is erger dan een rode.
echo "::error title=Back-up niet bewaard::De dump is gemaakt maar nergens heen geschreven (de upload naar een bucket buiten het project is nog niet gebouwd, zie stap 4 in scripts/backup/dump.sh). Er is dus GEEN terug te halen back-up." >&2
exit 1
# 4. TODO infra: upload de .gpg en het manifest naar de private backup-bucket BUITEN het
#    productieproject (aws s3 cp, rclone of een aparte Storage-bucket), en draai daarna
#    de retentie: bucket-listing | tsx scripts/backup/prune.ts | xargs bucket-delete.
