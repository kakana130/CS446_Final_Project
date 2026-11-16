#!/usr/bin/env bash
# Quick setup, clean-up — run in CloudShell when the project is graded:
#   bash ~/CS446_Final_Project/aws/iac/quick/3-destroy.sh
# `tofu destroy` (everything OpenTofu made), then terminates plate2home-build and deletes its
# images and their snapshots. The VPC is deleted by hand afterwards (Delete VPC in the console).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK="$HOME/plate2home-iac"
export AWS_DEFAULT_REGION=us-east-1
export PATH="$HOME/.local/bin:$PATH"
# Provider plugins (the AWS one is ~700 MB) go to /tmp: CloudShell's home folder holds only
# 1 GB. The state stays in $WORK; `tofu init` fetches the plugins again in a new session.
export TF_DATA_DIR=/tmp/plate2home-tofu

if [ -d "$WORK" ]; then
  cd "$WORK"
  tofu init -input=false >/dev/null
  echo ">> tofu destroy (about 10 minutes, mostly RDS)"
  tofu destroy -auto-approve -input=false -var "repo_dir=$REPO"
fi

IDS="$(aws ec2 describe-instances \
  --filters Name=tag:Name,Values=plate2home-build Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[].Instances[].InstanceId' --output text)"
if [ -n "$IDS" ]; then
  echo ">> Terminating plate2home-build ($IDS)"
  aws ec2 terminate-instances --instance-ids $IDS >/dev/null
  aws ec2 wait instance-terminated --instance-ids $IDS
fi

for AMI in $(aws ec2 describe-images --owners self --filters "Name=name,Values=plate2home-ami*" \
  --query 'Images[].ImageId' --output text); do
  SNAPS="$(aws ec2 describe-images --image-ids "$AMI" \
    --query 'Images[0].BlockDeviceMappings[].Ebs.SnapshotId' --output text)"
  echo ">> Deleting image $AMI"
  aws ec2 deregister-image --image-id "$AMI"
  for S in $SNAPS; do aws ec2 delete-snapshot --snapshot-id "$S"; done
done

echo
echo "CLEAN-UP DONE. Last step: VPC -> Your VPCs -> plate2home-vpc -> Actions -> Delete VPC"
