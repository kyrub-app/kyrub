#!/usr/bin/env bash
set -euo pipefail
set +x

: "${FIREBASE_PROJECT_ID:?Defina FIREBASE_PROJECT_ID}"
: "${PUBLIC_APP_URL:?Defina PUBLIC_APP_URL}"
: "${INTEGRATION_CRON_SECRET:?Defina INTEGRATION_CRON_SECRET}"

if [[ "${FIREBASE_PROJECT_ID}" != "kyrub-b8d0e" ]]; then
  echo "Projeto recusado: esperado kyrub-b8d0e." >&2
  exit 1
fi

if [[ ! "${PUBLIC_APP_URL}" =~ ^https:// ]]; then
  echo "PUBLIC_APP_URL precisa usar HTTPS." >&2
  exit 1
fi

LOCATION="${SCHEDULER_LOCATION:-southamerica-east1}"
TIME_ZONE="${SCHEDULER_TIME_ZONE:-America/Sao_Paulo}"
POLL_SCHEDULE="${NINETY_NINE_FOOD_POLL_SCHEDULE:-*/5 * * * *}"
BASE_URL="${PUBLIC_APP_URL%/}"
HEADERS="X-Cron-Secret=${INTEGRATION_CRON_SECRET},Content-Type=application/json"

common_flags() {
  printf '%s\n' \
    "--project=${FIREBASE_PROJECT_ID}" \
    "--location=${LOCATION}"
}

upsert_job() {
  local name="$1"
  local schedule="$2"
  local uri="$3"
  local description="$4"

  if gcloud scheduler jobs describe "${name}" \
    --project="${FIREBASE_PROJECT_ID}" \
    --location="${LOCATION}" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "${name}" \
      --project="${FIREBASE_PROJECT_ID}" \
      --location="${LOCATION}" \
      --schedule="${schedule}" \
      --time-zone="${TIME_ZONE}" \
      --uri="${uri}" \
      --http-method=POST \
      --update-headers="${HEADERS}" \
      --attempt-deadline=30s \
      --max-retry-attempts=3 \
      --min-backoff=10s \
      --max-backoff=60s \
      --description="${description}" \
      --quiet
    return
  fi

  gcloud scheduler jobs create http "${name}" \
    --project="${FIREBASE_PROJECT_ID}" \
    --location="${LOCATION}" \
    --schedule="${schedule}" \
    --time-zone="${TIME_ZONE}" \
    --uri="${uri}" \
    --http-method=POST \
    --headers="${HEADERS}" \
    --attempt-deadline=30s \
    --max-retry-attempts=3 \
    --min-backoff=10s \
    --max-backoff=60s \
    --description="${description}" \
    --quiet
}

upsert_job \
  "kyrub-99food-ingress-drain" \
  "* * * * *" \
  "${BASE_URL}/api/integrations/99food/internal/drain" \
  "Processa a fila durável de webhooks 99Food."

upsert_job \
  "kyrub-99food-poll-all" \
  "${POLL_SCHEDULE}" \
  "${BASE_URL}/api/integrations/99food/internal/poll-all" \
  "Reconcilia conexões 99Food pelo intervalo homologado."

upsert_job \
  "kyrub-delivery-fallback" \
  "* * * * *" \
  "${BASE_URL}/api/delivery-opportunities/internal/escalate" \
  "Escala entregas sem aceite Kyrub após a janela operacional."

echo "Schedulers Kyrub aplicados em ${LOCATION}."
echo "Execute cada job manualmente e revise o painel de Saúde do sistema."
