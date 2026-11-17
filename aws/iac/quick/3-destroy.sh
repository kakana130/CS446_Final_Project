#!/usr/bin/env bash
# Quick setup, clean-up — run in CloudShell when the project is graded:
#   bash ~/CS446_Final_Project/aws/iac/quick/3-destroy.sh
# `tofu destroy` (everything OpenTofu made), then terminates plate2home-build, deletes its
# images and their snapshots, the three security groups and the VPC (with its subnets, route
# tables, internet gateway and S3 endpoint). Safe to run again; things already gone are skipped.
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
  echo ">> Preparing OpenTofu (downloads its AWS plugin, about 1 minute)"
  tofu init -input=false >/dev/null
  # Destroy still asks for every variable, and an earlier clean-up removed ami_id. Any value
  # works here: nothing is created from it.
  if [ -f 08-asg.tf ] && ! grep -q '^ami_id' terraform.tfvars 2>/dev/null; then
    echo 'ami_id = "none"' >>terraform.tfvars
  fi
  echo ">> tofu destroy (about 10 minutes, mostly RDS)"
  tofu destroy -auto-approve -input=false -var "repo_dir=$REPO"
fi

IDS="$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=*plate2home-build*" Name=instance-state-name,Values=pending,running,stopping,stopped \
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
# The images are gone, so a later 2-finish.sh must make a new one.
if [ -f "$WORK/terraform.tfvars" ]; then sed -i '/^ami_id/d' "$WORK/terraform.tfvars"; fi

# --- Security groups and the VPC (made by hand in the guide) ---------------------------------
# Deleting waits for the network interfaces of the load balancer and RDS to go away, which can
# take a few minutes, so each delete is retried. Failures here do not stop the script.
set +e
quiet() { "$@" >/dev/null 2>&1; }
# retry <seconds> <description> <command…>: run the command every 15 s until it succeeds.
retry() {
  local limit="$1" what="$2" waited=0
  shift 2
  until "$@" >/dev/null 2>&1; do
    if [ "$waited" -ge "$limit" ]; then
      echo "   gave up waiting for $what (run this script again in a few minutes)"
      return 1
    fi
    echo "   waiting for $what ..."
    sleep 15
    waited=$((waited + 15))
  done
}

SGS="$(aws ec2 describe-security-groups --filters "Name=group-name,Values=*plate2home*" \
  --query 'SecurityGroups[].GroupId' --output text)"
if [ -n "$SGS" ]; then
  echo ">> Deleting security groups ($SGS)"
  # Their rules point at each other, which blocks deleting them: drop the rules first.
  for G in $SGS; do
    IN="$(aws ec2 describe-security-groups --group-ids "$G" --query 'SecurityGroups[0].IpPermissions' --output json)"
    OUT="$(aws ec2 describe-security-groups --group-ids "$G" --query 'SecurityGroups[0].IpPermissionsEgress' --output json)"
    [ "$IN" != "[]" ] && quiet aws ec2 revoke-security-group-ingress --group-id "$G" --ip-permissions "$IN"
    [ "$OUT" != "[]" ] && quiet aws ec2 revoke-security-group-egress --group-id "$G" --ip-permissions "$OUT"
  done
  for G in $SGS; do retry 600 "security group $G to be free" aws ec2 delete-security-group --group-id "$G"; done
fi

for VPC in $(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=*plate2home*" \
  --query 'Vpcs[].VpcId' --output text); do
  echo ">> Deleting VPC $VPC and what is inside it"
  for E in $(aws ec2 describe-vpc-endpoints --filters "Name=vpc-id,Values=$VPC" \
    --query 'VpcEndpoints[].VpcEndpointId' --output text); do
    quiet aws ec2 delete-vpc-endpoints --vpc-endpoint-ids "$E"
  done
  for N in $(aws ec2 describe-nat-gateways --filter "Name=vpc-id,Values=$VPC" \
    --query "NatGateways[?State!='deleted'].NatGatewayId" --output text); do
    quiet aws ec2 delete-nat-gateway --nat-gateway-id "$N"
  done
  for S in $(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC" \
    --query 'Subnets[].SubnetId' --output text); do
    retry 600 "subnet $S to be free" aws ec2 delete-subnet --subnet-id "$S"
  done
  for R in $(aws ec2 describe-route-tables --filters "Name=vpc-id,Values=$VPC" \
    --query 'RouteTables[?length(Associations[?Main]) == `0`].RouteTableId' --output text); do
    quiet aws ec2 delete-route-table --route-table-id "$R"
  done
  for I in $(aws ec2 describe-internet-gateways --filters "Name=attachment.vpc-id,Values=$VPC" \
    --query 'InternetGateways[].InternetGatewayId' --output text); do
    quiet aws ec2 detach-internet-gateway --internet-gateway-id "$I" --vpc-id "$VPC"
    quiet aws ec2 delete-internet-gateway --internet-gateway-id "$I"
  done
  retry 300 "VPC $VPC to be deleted" aws ec2 delete-vpc --vpc-id "$VPC"
done

echo
echo "Left over (should all be empty):"
echo "  instances: $(aws ec2 describe-instances --filters "Name=tag:Name,Values=*plate2home*" Name=instance-state-name,Values=pending,running,stopping,stopped --query 'Reservations[].Instances[].InstanceId' --output text)"
echo "  RDS:       $(aws rds describe-db-instances --query "DBInstances[?starts_with(DBInstanceIdentifier,'plate2home')].DBInstanceIdentifier" --output text)"
echo "  ALB:       $(aws elbv2 describe-load-balancers --query "LoadBalancers[?starts_with(LoadBalancerName,'plate2home')].LoadBalancerName" --output text)"
echo "  S3:        $(aws s3api list-buckets --query "Buckets[?starts_with(Name,'plate2home')].Name" --output text)"
echo "  VPC:       $(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=*plate2home*" --query 'Vpcs[].VpcId' --output text)"
echo "If something is still listed, run this script again in a few minutes."
echo "CLEAN-UP DONE (VPC included). You can End Lab now."
