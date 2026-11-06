#!/usr/bin/env bash
# Offline contract tests: exported shell functions replace Azure CLI and curl.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
work="azure/.test-work-$$"
mkdir "$work"
trap 'rm -rf "$work"' EXIT
export MOCK_DIR="$PWD/$work"
export MOCK_SUB=11111111-1111-1111-1111-111111111111
export MOCK_SCOPE="/subscriptions/$MOCK_SUB/resourceGroups/rg-sre-lab-demo"
export MOCK_STATE="$MOCK_DIR/state"
export MOCK_LOG="$MOCK_DIR/az.log"
reset() {
  printf '80|mcr.microsoft.com/k8se/quickstart:latest|demo-app--base|demo-app--base|true|Single\n' > "$MOCK_STATE"
  : > "$MOCK_LOG"
  : > "$MOCK_DIR/app"
  : > "$MOCK_DIR/env"
  rm -f "$MOCK_DIR/extra" "$MOCK_DIR/unowned" "$MOCK_DIR/resource-unowned" \
    "$MOCK_DIR/tls" "$MOCK_DIR/new" "$MOCK_DIR/pending"
}
load_state() { IFS='|' read -r port image ready latest active mode < "$MOCK_STATE"; }
save_state() { printf '%s|%s|%s|%s|%s|%s\n' "$port" "$image" "$ready" "$latest" "$active" "$mode" > "$MOCK_STATE"; }
az() {
  printf '%s\n' "$*" >> "$MOCK_LOG"
  local args=("$@") query= id= value= revision= subscription= group= name= i
  for ((i=0; i<${#args[@]}; i++)); do
    case "${args[$i]}" in
      --query) query=${args[$((i+1))]} ;;
      --ids) id=${args[$((i+1))]} ;;
      --image|--target-port|--mode) value=${args[$((i+1))]} ;;
      --revision) revision=${args[$((i+1))]} ;;
      --subscription) subscription=${args[$((i+1))]} ;;
      --resource-group) group=${args[$((i+1))]} ;;
      --name) name=${args[$((i+1))]} ;;
    esac
  done
  [[ $subscription == "$MOCK_SUB" ]] || return 91
  [[ -z $group || $group == rg-sre-lab-demo ]] || return 92
  [[ -z $id || $id == "$MOCK_SCOPE/providers/Microsoft.App/containerApps/demo-app" ||
    $id == "$MOCK_SCOPE/providers/Microsoft.App/managedEnvironments/demo-env" ]] || return 93
  load_state
  case "$1 $2 ${3:-}" in
    'group exists --name') if [[ -f $MOCK_DIR/new ]]; then echo false; else echo true; fi ;;
    'group show --name'|'resource show --ids')
      if [[ -f $MOCK_DIR/unowned || ( -n $id && -f $MOCK_DIR/resource-unowned ) ]]; then echo unrelated
      elif [[ $query == tags.purpose ]]; then echo copilot-sre-lab
      elif [[ $query == tags.labId ]]; then echo demo
      else return 94; fi ;;
    'resource list --resource-group')
      [[ ! -f $MOCK_DIR/app ]] || echo "$MOCK_SCOPE/providers/Microsoft.App/containerApps/demo-app"
      [[ ! -f $MOCK_DIR/env ]] || echo "$MOCK_SCOPE/providers/Microsoft.App/managedEnvironments/demo-env"
      [[ ! -f $MOCK_DIR/extra ]] || echo "$MOCK_SCOPE/providers/Microsoft.Storage/storageAccounts/unrelated"
      return 0 ;;
    'containerapp show --name')
      [[ $name == demo-app ]] || return 95
      case "$query" in
        properties.configuration.ingress.targetPort) echo "$port" ;;
        'properties.template.containers[0].image') echo "$image" ;;
        properties.latestReadyRevisionName) echo "$ready" ;;
        properties.latestRevisionName) echo "$latest" ;;
        properties.configuration.activeRevisionsMode) echo "$mode" ;;
        properties.configuration.ingress.fqdn) echo demo-app.test.azurecontainerapps.io ;;
        *) return 96 ;;
      esac ;;
    'containerapp revision show')
      [[ $revision == demo-app--* ]] || return 97
      case "$query" in
        properties.active) echo "$active" ;;
        properties.provisioningState)
          if [[ -f $MOCK_DIR/pending ]]; then echo Provisioning; else echo Failed; fi ;;
        *) return 98 ;;
      esac ;;
    'containerapp ingress update') port=$value; save_state ;;
    'containerapp update --name')
      image=$value
      latest=demo-app--new
      if [[ $image == mcr.microsoft.com/k8se/quickstart:latest ]]; then ready=$latest; fi
      save_state ;;
    'containerapp revision set-mode')
      if [[ $value == multiple ]]; then mode=Multiple; else mode=Single; fi
      save_state ;;
    'containerapp revision deactivate')
      [[ $mode == Multiple ]] || return 99
      active=false; save_state ;;
    'containerapp revision activate') active=true; save_state ;;
    'resource delete --ids')
      case "$id" in
        */containerApps/demo-app) rm "$MOCK_DIR/app" ;;
        */managedEnvironments/demo-env) [[ ! -f $MOCK_DIR/app ]] || return 100; rm "$MOCK_DIR/env" ;;
      esac ;;
    'provider show --namespace') echo Registered ;;
    'group create --name') rm "$MOCK_DIR/new" ;;
    'deployment group create') : ;;
    *) printf 'Unexpected mocked az command: %s\n' "$*" >&2; return 101 ;;
  esac
}
curl() {
  [[ ! -f $MOCK_DIR/tls ]] || return 60
  [[ $* == *https://demo-app.test.azurecontainerapps.io/* ]] || return 102
  load_state
  if [[ $port == 81 || $active == false ]]; then printf 503; else printf 200; fi
}
sleep() { :; }
export -f az curl sleep load_state save_state
lab() {
  bash azure/lab.sh "$@" --subscription "$MOCK_SUB" --resource-group rg-sre-lab-demo --lab-id demo
}
approve() {
  local action=$1 incident=${2:-} token
  token="$action:$MOCK_SUB:rg-sre-lab-demo"
  if [[ -n $incident ]]; then
    token="$action:$incident:$MOCK_SUB:rg-sre-lab-demo"
    lab "$action" --incident "$incident" --confirm "$token"
  else
    lab "$action" --location eastus2 --confirm "$token"
  fi
}
reject() {
  if "$@" > "$MOCK_DIR/rejected.log" 2>&1; then
    printf 'Expected refusal: %s\n' "$*" >&2
    exit 1
  fi
}
reset
reject lab break --incident config
reject lab fix --incident config --confirm break:config:$MOCK_SUB:rg-sre-lab-demo
reject lab teardown --confirm yes
reject lab deploy --location eastus2
[[ ! -s $MOCK_LOG ]]
reject bash azure/lab.sh verify --subscription "$MOCK_SUB" --resource-group production --lab-id demo
reject lab verify --expect bogus
[[ ! -s $MOCK_LOG ]]
lab verify
for incident in config image scale; do
  reset
  approve break "$incident"
  lab verify --expect "$incident"
  approve fix "$incident"
  lab verify
done
reset
approve break config
reject approve fix scale
reject approve fix image
approve fix config
reset
approve break image
touch "$MOCK_DIR/pending"
reject lab verify --expect image
rm "$MOCK_DIR/pending"
approve fix image
reset
touch "$MOCK_DIR/tls"
reject lab verify
reject approve break config
! grep -q 'ingress update' "$MOCK_LOG"
reset
touch "$MOCK_DIR/unowned"
reject approve break config
reject approve teardown
! grep -q 'resource delete' "$MOCK_LOG"
reset
touch "$MOCK_DIR/resource-unowned"
reject approve break config
reject approve teardown
! grep -q 'resource delete' "$MOCK_LOG"
reset
touch "$MOCK_DIR/extra"
reject approve teardown
! grep -q 'resource delete' "$MOCK_LOG"
reset
approve teardown
[[ ! -f $MOCK_DIR/app && ! -f $MOCK_DIR/env ]]
! grep -q 'group delete' "$MOCK_LOG"
reset
rm "$MOCK_DIR/app"
approve teardown
approve teardown
[[ ! -f $MOCK_DIR/env ]]
reset
reject approve deploy
! grep -q 'group create' "$MOCK_LOG"
touch "$MOCK_DIR/new"
approve deploy
grep -q 'deployment group create' "$MOCK_LOG"
printf 'Offline Azure safety and scenario contracts passed (no real Azure or HTTP calls).\n'
