#!/usr/bin/env bash
# Quick setup, part 2 — run in CloudShell after setup.sh on plate2home-build printed
# "Plate2Home is running on this instance":
#   bash ~/CS446_Final_Project/aws/iac/quick/2-finish.sh
# Makes an AMI of the build instance, applies aws/iac/08-asg.tf (launch template + Auto
# Scaling group of 2), waits until both new instances are healthy behind the load balancer,
# then stops the build instance. Safe to run again.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK="$HOME/plate2home-iac"
export AWS_DEFAULT_REGION=us-east-1
export PATH="$HOME/.local/bin:$PATH"
# Provider plugins (the AWS one is ~700 MB) go to /tmp: CloudShell's home folder holds only
# 1 GB. The state stays in $WORK; `tofu init` fetches the plugins again in a new session.
export TF_DATA_DIR=/tmp/plate2home-tofu
cd "$WORK"
echo ">> Preparing OpenTofu (downloads its AWS plugin, about 1 minute)"
tofu init -input=false >/dev/null

builds() {
  aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=*plate2home-build*" "Name=instance-state-name,Values=$1" \
    --query 'Reservations[].Instances[].InstanceId' --output text
}
# The running build instance (the one just updated); otherwise the only one there is.
read -r -a RUNNING <<<"$(builds running)"
read -r -a ALL <<<"$(builds running,stopped)"
if [ "${#RUNNING[@]}" -eq 1 ]; then
  BUILD="${RUNNING[0]}"
elif [ "${#RUNNING[@]}" -eq 0 ] && [ "${#ALL[@]}" -eq 1 ]; then
  BUILD="${ALL[0]}"
elif [ "${#ALL[@]}" -eq 0 ]; then
  echo "!! No instance named plate2home-build. Check its name in EC2 -> Instances."
  exit 1
else
  echo "!! More than one plate2home-build (${ALL[*]}). Terminate the one you don't use"
  echo "   (EC2 -> Instances -> Instance state -> Terminate), then run this again."
  exit 1
fi

if grep -q '^ami_id' terraform.tfvars; then
  AMI="$(sed -n 's/^ami_id *= *"\(.*\)"/\1/p' terraform.tfvars)"
else
  NAME="plate2home-ami-$(date +%Y%m%d-%H%M)"
  echo ">> Creating image $NAME from $BUILD (the instance restarts once)"
  AMI="$(aws ec2 create-image --instance-id "$BUILD" --name "$NAME" --query ImageId --output text)"
  echo "ami_id = \"$AMI\"" >>terraform.tfvars
fi

echo ">> Waiting for image $AMI (5-10 minutes)"
for _ in $(seq 1 60); do
  STATE="$(aws ec2 describe-images --image-ids "$AMI" --query 'Images[0].State' --output text)"
  [ "$STATE" = "available" ] && break
  if [ "$STATE" = "failed" ]; then
    echo "!! The image failed. Delete the ami_id line in ~/plate2home-iac/terraform.tfvars and run again."
    exit 1
  fi
  echo "   still $STATE ..."
  sleep 20
done

echo ">> Creating the launch template and the Auto Scaling group"
cp "$REPO/aws/iac/08-asg.tf" .
tofu apply -auto-approve -input=false -var "repo_dir=$REPO"

TG="$(aws elbv2 describe-target-groups --names plate2home-tg \
  --query 'TargetGroups[0].TargetGroupArn' --output text)"

# A new version: replace the web servers still on an older template version, one at a time,
# so the site stays up. (Learner Lab denies instance refresh, which would do this for us.)
asg() {
  aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names plate2home-asg \
    --query "AutoScalingGroups[0].$1" --output text
}
VERSION="$(asg LaunchTemplate.Version)"
read -r -a OLD <<<"$(asg "Instances[?LaunchTemplate.Version!='$VERSION'].InstanceId")"
# When the Learner Lab session ends (its timer runs out), AWS denies every call through the
# voc-cancel-cred policy. Stop with a clear message instead of waiting on errors.
check_lab() {
  local err
  if ! err="$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names plate2home-asg     --query 'AutoScalingGroups[0].AutoScalingGroupName' --output text 2>&1 >/dev/null)" &&
    grep -q voc-cancel-cred <<<"$err"; then
    echo "!! The Learner Lab session ended (the timer ran out), so AWS refuses every call."
    echo "   Start Lab again, open CloudShell again, then run this script again: it carries on"
    echo "   where it stopped (the new image is kept)."
    exit 1
  fi
}
healthy_new() {
  local n=0 id state
  for id in $(asg "Instances[?LaunchTemplate.Version=='$VERSION' && LifecycleState=='InService'].InstanceId"); do
    state="$(aws elbv2 describe-target-health --target-group-arn "$TG" --targets "Id=$id" \
      --query 'TargetHealthDescriptions[0].TargetHealth.State' --output text)"
    [ "$state" = "healthy" ] && n=$((n + 1))
  done
  echo "$n"
}
DONE=0
for ID in "${OLD[@]}"; do
  DONE=$((DONE + 1))
  echo ">> Replacing web server $ID with the new version ($DONE of ${#OLD[@]}, 3-5 minutes)"
  # If Learner Lab refuses the Auto Scaling call too, terminating the instance itself works:
  # the group sees it gone and launches a replacement from the newest template version.
  aws autoscaling terminate-instance-in-auto-scaling-group --instance-id "$ID" \
    --no-should-decrement-desired-capacity >/dev/null 2>&1 ||
    aws ec2 terminate-instances --instance-ids "$ID" >/dev/null
  for _ in $(seq 1 45); do
    sleep 20
    check_lab
    NEW="$(healthy_new)"
    [ "$NEW" -ge "$DONE" ] && break
    echo "   waiting for the new server to be healthy ..."
  done
  if [ "$NEW" -lt "$DONE" ]; then
    echo "!! The new server did not become healthy. See EC2 -> Target groups -> plate2home-tg -> Targets."
    exit 1
  fi
done

echo ">> Waiting for 2 healthy web servers (3-5 minutes)"
HEALTHY=0
for _ in $(seq 1 45); do
  check_lab
  HEALTHY="$(aws elbv2 describe-target-health --target-group-arn "$TG" \
    --query "length(TargetHealthDescriptions[?TargetHealth.State=='healthy' && Target.Id!='$BUILD'])" \
    --output text)"
  [ "$HEALTHY" -ge 2 ] && break
  echo "   $HEALTHY of 2 healthy ..."
  sleep 20
done
if [ "$HEALTHY" -lt 2 ]; then
  echo "!! The web servers did not become healthy. See EC2 -> Target groups -> plate2home-tg -> Targets."
  exit 1
fi

aws ec2 stop-instances --instance-ids "$BUILD" >/dev/null
echo ">> Stopped plate2home-build (kept for building new versions)"
echo
echo "Website address: $(tofu output -raw site_url)"
echo "PART 2 DONE"
