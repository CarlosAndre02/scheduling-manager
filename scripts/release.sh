#!/usr/bin/env bash
#
# Installs a published image on the application instance.
#
#   scripts/release.sh <commit-sha>   deploy, or roll back — the same operation
#   scripts/release.sh --list         what ECR still holds, newest first
#
# Deploy and rollback are one command because they are one thing: naming which
# already-built image should be running. There is no rollback build, no rollback
# path, and therefore nothing about rolling back that is only exercised during an
# incident.
#
# Needs credentials that may write /<project>/image-tag and send the deploy
# document — the CI role has exactly those, and so does an administrator.
set -euo pipefail

readonly PROJECT="${PROJECT:-scheduling-manager}"
readonly REGION="${AWS_REGION:-us-east-1}"
readonly DOCUMENT="$PROJECT-deploy"
readonly INSTANCE_TAG="$PROJECT-app"

# The document allows the deploy itself 600 seconds; this outlives that, so a
# timeout here always means the caller gave up rather than the deploy passing
# unnoticed.
readonly WAIT_SECONDS=660
readonly POLL_SECONDS=5

usage() {
  sed -n '3,6p' "$0" | cut -c3-
  exit "${1:-1}"
}

handle_list() {
  echo "Published, newest first — what can be released:"
  aws ecr describe-images --region "$REGION" --repository-name "$PROJECT" \
    --query 'reverse(sort_by(imageDetails,&imagePushedAt))[:10].[imageTags[0],imagePushedAt]' \
    --output text

  # Push order is not release order: a release can be skipped, and a rollback
  # publishes nothing at all. The parameter's history is the only record of
  # what was actually asked for, and in what order — which is what a rollback
  # needs to know. The newest entry is the last deploy's intent, so it names a
  # broken release if that deploy failed.
  echo
  echo "Released, newest first — the top entry is what the host was last told to run:"
  aws ssm get-parameter-history --region "$REGION" --name "/$PROJECT/image-tag" \
    --query 'reverse(Parameters)[:10].[Value,LastModifiedDate]' --output text
}

# What the parameter says was last asked for, which is what a rollback needs and
# what the instance is running unless the last deploy failed.
released_tag() {
  aws ssm get-parameter --region "$REGION" --name "/$PROJECT/image-tag" \
    --query Parameter.Value --output text
}

# Before the parameter moves, not after. A tag that was never published still
# writes cleanly, and the failure then surfaces on the host as a pull error with
# the previous containers already gone.
assert_published() {
  local tag="$1"

  if ! aws ecr describe-images --region "$REGION" --repository-name "$PROJECT" \
       --image-ids imageTag="$tag" >/dev/null 2>&1; then
    echo "$PROJECT:$tag is not in ECR — check scripts/release.sh --list" >&2
    exit 1
  fi
}

# Not `aws ssm wait command-executed`: that waiter is a fixed 20 attempts five
# seconds apart, so a deploy slower than 100 seconds fails the caller while
# succeeding on the host — the worst of the two answers. A cold pull on a
# burstable instance is routinely slower than that.
wait_for() {
  local id="$1" waited=0 status

  while [ "$waited" -lt "$WAIT_SECONDS" ]; do
    sleep "$POLL_SECONDS"
    waited=$(( waited + POLL_SECONDS ))

    # Targeted by tag, so the instance id is not known here. Listing by command
    # id avoids having to resolve it, and reports InvocationDoesNotExist as an
    # empty list rather than as an error during the first seconds.
    status=$(aws ssm list-command-invocations --region "$REGION" --command-id "$id" \
      --query 'CommandInvocations[0].Status' --output text 2>/dev/null || echo None)

    case "$status" in
      Success)
        report "$id"
        return 0
        ;;
      Failed | Cancelled | TimedOut)
        report "$id" >&2
        echo "deploy $status" >&2
        return 1
        ;;
    esac
  done

  echo "gave up after $WAIT_SECONDS seconds; the command may still be running: $id" >&2
  return 1
}

report() {
  aws ssm list-command-invocations --region "$REGION" --command-id "$1" --details \
    --query 'CommandInvocations[0].CommandPlugins[0].Output' --output text
}

handle_release() {
  local tag="$1" previous

  if ! [[ "$tag" =~ ^[a-zA-Z0-9._-]+$ ]]; then
    echo "not a valid image tag: $tag" >&2
    exit 1
  fi

  assert_published "$tag"
  previous=$(released_tag)

  if [ -t 0 ]; then
    echo "$PROJECT: $previous -> $tag"
    read -r -p "Deploy to production? [y/N] " answer
    [ "$answer" = "y" ] || { echo "cancelled"; exit 1; }
  fi

  # The parameter first, so the instance still reads the intended release if it
  # reboots between these two calls.
  aws ssm put-parameter --region "$REGION" --name "/$PROJECT/image-tag" \
    --type String --value "$tag" --overwrite >/dev/null

  local id
  id=$(aws ssm send-command --region "$REGION" \
    --document-name "$DOCUMENT" \
    --targets "Key=tag:Name,Values=$INSTANCE_TAG" \
    --query Command.CommandId --output text)

  echo "deploying $tag (command $id)"

  if ! wait_for "$id"; then
    echo >&2
    echo "the instance is not serving $tag; roll back with:" >&2
    echo "  scripts/release.sh $previous" >&2
    exit 1
  fi
}

case "${1:-}" in
  --list) handle_list ;;
  -h | --help) usage 0 ;;
  "") usage ;;
  *) handle_release "$1" ;;
esac
