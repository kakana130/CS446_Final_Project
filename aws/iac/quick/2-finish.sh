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
tofu init -input=false >/dev/null

BUILD="$(aws ec2 describe-instances \
  --filters Name=tag:Name,Values=plate2home-build Name=instance-state-name,Values=running,stopped \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)"
if [ "$BUILD" = "None" ]; then
  echo "!! No instance named plate2home-build. Check its name in EC2 -> Instances."
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
echo ">> Waiting for 2 healthy web servers (3-5 minutes)"
HEALTHY=0
for _ in $(seq 1 45); do
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
