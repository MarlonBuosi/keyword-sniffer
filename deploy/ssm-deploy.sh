#!/usr/bin/env bash
#
# Trigger a deploy through AWS SSM and wait for it (used by the CI `deploy` job;
# expects AWS credentials + region in the environment).
#   deploy/ssm-deploy.sh <instance-id> <commit-sha>
set -euo pipefail

instance=${1:?instance id required}
commit=${2:?commit sha required}
DOCUMENT=wa-monitor-deploy
TIMEOUT_S=900

command_id=$(aws ssm send-command \
  --instance-ids "$instance" \
  --document-name "$DOCUMENT" \
  --parameters "commit=$commit" \
  --comment "deploy ${commit:0:7}" \
  --query Command.CommandId --output text)
echo "SSM command $command_id: deploying ${commit:0:7} to $instance"

invocation() {
  aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance" \
    --query "$1" --output text
}

start=$SECONDS
while :; do
  # Right after send-command the invocation may not exist yet: treat as Pending.
  status=$(invocation Status 2>/dev/null || echo Pending)
  case $status in
    Pending | InProgress | Delayed) ;;
    *) break ;;
  esac
  if (( SECONDS - start > TIMEOUT_S )); then
    echo "timed out after ${TIMEOUT_S}s waiting for the deploy (last status: $status)" >&2
    exit 1
  fi
  sleep 5
done

echo "----- server output -----"
invocation StandardOutputContent
stderr=$(invocation StandardErrorContent)
if [[ -n $stderr && $stderr != None ]]; then
  echo "----- server stderr -----"
  echo "$stderr"
fi
echo "-------------------------"
echo "status: $status"
[[ $status == Success ]]
