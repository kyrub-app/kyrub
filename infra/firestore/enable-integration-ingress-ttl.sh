#!/usr/bin/env bash
set -euo pipefail

: "${FIREBASE_PROJECT_ID:?Defina FIREBASE_PROJECT_ID}"

if [[ "${FIREBASE_PROJECT_ID}" != "kyrub-b8d0e" ]]; then
  echo "Projeto recusado: esperado kyrub-b8d0e." >&2
  exit 1
fi

gcloud firestore fields ttls update expiresAt \
  --project="${FIREBASE_PROJECT_ID}" \
  --database="(default)" \
  --collection-group=integrationIngress \
  --enable-ttl \
  --quiet

gcloud firestore fields ttls list \
  --project="${FIREBASE_PROJECT_ID}" \
  --database="(default)" \
  --collection-group=integrationIngress
