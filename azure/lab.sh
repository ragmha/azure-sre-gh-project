#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'HELP'
Opt-in paid Azure lab; nothing runs without an explicit command.
bash azure/lab.sh deploy|verify|break|fix|teardown \
  --subscription GUID --resource-group rg-sre-lab-ID --lab-id ID \
  [--location REGION] [--incident config|image|scale] \
  [--expect healthy|config|image|scale] [--confirm EXACT-TOKEN]

deploy requires --location and --confirm deploy:SUBSCRIPTION:RESOURCE-GROUP
break/fix require --incident and --confirm ACTION:INCIDENT:SUBSCRIPTION:RESOURCE-GROUP
teardown requires --confirm teardown:SUBSCRIPTION:RESOURCE-GROUP
verify is read-only but sends HTTP requests (can wake a billed replica).
Run only in a dedicated disposable lab subscription/resource group.
HELP
}
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ $# -gt 0 ]] || { usage; exit 1; }
action=$1
shift
subscription= group= lab_id= location= incident= confirmation= expected=healthy
while [[ $# -gt 0 ]]; do
  [[ $# -ge 2 ]] || die "Missing value for $1"
  case "$1" in
    --subscription) subscription=$2 ;;
    --resource-group) group=$2 ;;
    --lab-id) lab_id=$2 ;;
    --location) location=$2 ;;
    --incident) incident=$2 ;;
    --expect) expected=$2 ;;
    --confirm) confirmation=$2 ;;
    *) die "Unknown option: $1" ;;
  esac
  shift 2
done
case "$action" in deploy|verify|break|fix|teardown) ;; *) die "Unknown action" ;; esac
[[ $subscription =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] ||
  die "An explicit subscription GUID is required"
[[ $lab_id =~ ^[a-z][a-z0-9-]{1,18}[a-z0-9]$ && $lab_id != *--* ]] ||
  die "lab-id must be 3-20 lowercase letters/digits/hyphens, starting with a letter"
[[ $group == "rg-sre-lab-$lab_id" ]] || die "Resource group must be rg-sre-lab-$lab_id"
case "$expected" in healthy|config|image|scale) ;; *) die "Invalid expectation" ;; esac
token="$action:$subscription:$group"
if [[ $action == break || $action == fix ]]; then
  case "$incident" in config|image|scale) ;; *) die "Choose incident config, image, or scale" ;; esac
  token="$action:$incident:$subscription:$group"
fi
if [[ $action != verify ]]; then
  [[ $confirmation == "$token" ]] || die "Human approval required: --confirm '$token'"
fi
if [[ $action == deploy ]]; then
  [[ $location =~ ^[a-z0-9]+$ ]] || die "deploy requires an explicit canonical --location"
fi
command -v az >/dev/null || die "Install Azure CLI manually"
command -v curl >/dev/null || die "curl is required"
# Never install extensions or change the caller's default subscription.
export AZURE_EXTENSION_USE_DYNAMIC_INSTALL=no
azs() { az "$@" --subscription "$subscription" --only-show-errors; }
app="$lab_id-app"
environment="$lab_id-env"
scope="/subscriptions/$subscription/resourceGroups/$group"
app_id="$scope/providers/Microsoft.App/containerApps/$app"
env_id="$scope/providers/Microsoft.App/managedEnvironments/$environment"
good_image='mcr.microsoft.com/k8se/quickstart:latest'
bad_image="mcr.microsoft.com/k8se/quickstart:lab-missing-$lab_id"
root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

check_tags() {
  local id=$1 purpose owner
  purpose=$(azs resource show --ids "$id" --query tags.purpose -o tsv)
  owner=$(azs resource show --ids "$id" --query tags.labId -o tsv)
  [[ $purpose == copilot-sre-lab && $owner == "$lab_id" ]] ||
    die "Refusing unowned resource: $id"
}
check_group() {
  local purpose owner
  purpose=$(azs group show --name "$group" --query tags.purpose -o tsv)
  owner=$(azs group show --name "$group" --query tags.labId -o tsv)
  [[ $purpose == copilot-sre-lab && $owner == "$lab_id" ]] ||
    die "Resource group ownership tags do not match"
}
inventory() {
  local id
  resource_ids=$(azs resource list --resource-group "$group" --query '[].id' -o tsv)
  while IFS= read -r id; do
    [[ -n $id ]] || continue
    # Azure resource IDs are case insensitive.
    case "$(printf '%s' "$id" | tr '[:upper:]' '[:lower:]')" in
      "$(printf '%s' "$app_id" | tr '[:upper:]' '[:lower:]')"|\
      "$(printf '%s' "$env_id" | tr '[:upper:]' '[:lower:]')") check_tags "$id" ;;
      *) die "Unexpected resource in dedicated lab group: $id" ;;
    esac
  done <<< "$resource_ids"
}
get_app() { azs containerapp show --name "$app" --resource-group "$group" --query "$1" -o tsv; }
revision_active() {
  azs containerapp revision show --name "$app" --resource-group "$group" \
    --revision "$1" --query properties.active -o tsv
}
ready_revision() {
  ready=$(get_app properties.latestReadyRevisionName)
  [[ $ready == "$app--"* && $ready != *$'\n'* ]] || die "No valid ready revision; inspect the lab in the portal"
}
verify_once() {
  local port image latest active fqdn status revision_state mode
  port=$(get_app properties.configuration.ingress.targetPort) || return 1
  image=$(get_app 'properties.template.containers[0].image') || return 1
  ready_revision
  latest=$(get_app properties.latestRevisionName) || return 1
  active=$(revision_active "$ready") || return 1
  mode=$(get_app properties.configuration.activeRevisionsMode) || return 1
  case "$expected" in
    healthy) [[ $port == 80 && $image == "$good_image" && $active == true && $latest == "$ready" && $mode == Single ]] || return 1 ;;
    config) [[ $port == 81 && $image == "$good_image" && $active == true ]] || return 1 ;;
    scale) [[ $port == 80 && $image == "$good_image" && $active == false && $mode == Multiple ]] || return 1 ;;
    image)
      [[ $port == 80 && $image == "$bad_image" && $active == true && $latest != "$ready" && $latest == "$app--"* ]] || return 1
      revision_state=$(azs containerapp revision show --name "$app" --resource-group "$group" \
        --revision "$latest" --query properties.provisioningState -o tsv) || return 1
      [[ $revision_state == Failed ]] || return 1
      ;;
  esac
  fqdn=$(get_app properties.configuration.ingress.fqdn) || return 1
  [[ $fqdn =~ ^[a-zA-Z0-9.-]+\.azurecontainerapps\.io$ ]] || die "Unexpected public Azure endpoint"
  # Transport/DNS/TLS failures are NOT evidence of a deliberately broken app.
  status=$(curl --silent --show-error --proto '=https' --connect-timeout 5 --max-time 10 \
    --output /dev/null --write-out '%{http_code}' "https://$fqdn/") || return 1
  case "$expected" in
    healthy|image) [[ $status == 200 ]] || return 1 ;;
    config|scale) [[ $status =~ ^[45][0-9][0-9]$ ]] || return 1 ;;
  esac
  printf 'Verified %s: HTTPS %s from %s (ready revision %s, active=%s)\n' \
    "$expected" "$status" "$fqdn" "$ready" "$active"
}
verify() {
  local attempt attempts=36
  # Failed image pulls can take several minutes to reach a terminal revision state.
  if [[ $expected == image ]]; then attempts=120; fi
  for ((attempt=1; attempt<=attempts; attempt++)); do
    if verify_once; then return 0; fi
    if ((attempt < attempts)); then sleep 5; fi
  done
  die "Verification timed out for $expected; inspect revisions and ingress. No automatic rollback or further write was attempted."
}

if [[ $action == deploy ]]; then
  exists=$(azs group exists --name "$group" -o tsv)
  [[ $exists == false ]] || die "deploy requires a NEW resource group; never adopts or overwrites an existing group"
  registered=$(azs provider show --namespace Microsoft.App --query registrationState -o tsv)
  [[ $registered == Registered ]] || die "Ask a subscription administrator to register Microsoft.App first"
  azs group create --name "$group" --location "$location" \
    --tags purpose=copilot-sre-lab "labId=$lab_id" -o none
  azs deployment group create --name sre-lab --resource-group "$group" \
    --template-file "$root/main.bicep" --parameters "labId=$lab_id" "location=$location" -o none
  check_group
  inventory
  expected=healthy
  verify
  exit 0
fi
check_group
inventory
if [[ $action == teardown ]]; then
  # Delete only the two exact tagged resource IDs, never the entire group.
  for id in "$app_id" "$env_id"; do
    while IFS= read -r existing; do
      if [[ $(printf '%s' "$existing" | tr '[:upper:]' '[:lower:]') == "$(printf '%s' "$id" | tr '[:upper:]' '[:lower:]')" ]]; then
        check_tags "$id"
        azs resource delete --ids "$id"
      fi
    done <<< "$resource_ids"
  done
  remaining=$(azs resource list --resource-group "$group" --query '[].id' -o tsv)
  [[ -z $remaining ]] || die "Resources remain; inspect manually. The resource group was not deleted."
  printf 'Lab resources deleted. Empty resource group %s retained to prevent deleting unrelated resources.\n' "$group"
  exit 0
fi
check_tags "$app_id"
check_tags "$env_id"
if [[ $action == verify ]]; then verify; exit 0; fi

if [[ $action == break ]]; then
  expected=healthy
  verify
  case "$incident" in
    config)
      azs containerapp ingress update --name "$app" --resource-group "$group" --target-port 81 -o none ;;
    image)
      azs containerapp update --name "$app" --resource-group "$group" \
        --image "$bad_image" --revision-suffix "bad-$RANDOM-$RANDOM" --no-wait -o none ;;
    scale)
      ready_revision
      azs containerapp revision set-mode --name "$app" --resource-group "$group" --mode multiple -o none
      azs containerapp revision deactivate --name "$app" --resource-group "$group" --revision "$ready" -o none ;;
  esac
  expected=$incident
  verify
else
  # Permit recovery after an interrupted break, without silently fixing another scenario.
  port=$(get_app properties.configuration.ingress.targetPort)
  image=$(get_app 'properties.template.containers[0].image')
  mode=$(get_app properties.configuration.activeRevisionsMode)
  ready_revision
  case "$incident" in
    config)
      [[ ( $port == 80 || $port == 81 ) && $image == "$good_image" && $mode == Single &&
        $(revision_active "$ready") == true ]] || die "Not an isolated config incident"
      azs containerapp ingress update --name "$app" --resource-group "$group" --target-port 80 -o none ;;
    image)
      [[ $port == 80 && ( $image == "$good_image" || $image == "$bad_image" ) && $mode == Single &&
        $(revision_active "$ready") == true ]] || die "Not an isolated image incident"
      azs containerapp update --name "$app" --resource-group "$group" \
        --image "$good_image" --revision-suffix "fix-$RANDOM-$RANDOM" -o none ;;
    scale)
      [[ $port == 80 && $image == "$good_image" ]] || die "Not an isolated scale incident"
      azs containerapp revision activate --name "$app" --resource-group "$group" --revision "$ready" -o none
      azs containerapp revision set-mode --name "$app" --resource-group "$group" --mode single -o none ;;
  esac
  expected=healthy
  verify
fi
