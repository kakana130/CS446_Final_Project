#!/usr/bin/env bash
# Start over: delete EVERYTHING Plate2Home made in this account (us-east-1), whatever state it
# is in — half-finished runs, a lost or broken OpenTofu state, leftovers from the Manual guide
# or the old default-VPC setup. Nothing here uses the OpenTofu state: resources are found by
# their plate2home names. Run in CloudShell:
#   bash ~/CS446_Final_Project/aws/iac/quick/reset-all.sh
# It asks you to type DELETE first. Takes about 15-20 minutes (RDS is the slow part).
# Safe to run again; things already gone are skipped.
set -uo pipefail

export AWS_DEFAULT_REGION=us-east-1
export AWS_PAGER=""

echo "This deletes every Plate2Home resource in this AWS account: web servers, load balancer,"
echo "database (no backup), photos, Lambda, SNS, EventBridge, security groups and the VPC."
read -r -p "Type DELETE to continue: " ANSWER
[ "$ANSWER" = "DELETE" ] || {
  echo "Stopped. Nothing was deleted."
  exit 1
}

say() { echo ">> $*"; }
quiet() { "$@" >/dev/null 2>&1; }
# wait_until <seconds> <description> <command…>: retry the command every 15 s until it succeeds.
wait_until() {
  local limit="$1" what="$2"
  shift 2
  local waited=0
  until "$@" >/dev/null 2>&1; do
    if [ "$waited" -ge "$limit" ]; then
      echo "   still waiting for $what, going on"
      return 1
    fi
    echo "   waiting for $what ..."
    sleep 15
    waited=$((waited + 15))
  done
}

# --- 1. EventBridge (so nothing calls the cleanup Lambda while we delete) -------------------
say "EventBridge"
for T in $(aws events list-targets-by-rule --rule plate2home-daily-cleanup \
  --query 'Targets[].Id' --output text 2>/dev/null); do
  quiet aws events remove-targets --rule plate2home-daily-cleanup --ids "$T"
done
quiet aws events delete-rule --name plate2home-daily-cleanup
quiet aws scheduler delete-schedule --name plate2home-daily-cleanup

# --- 2. RDS: start deleting now, it takes the longest ---------------------------------------
say "RDS (deleting in the background, no final snapshot)"
DBS="$(aws rds describe-db-instances \
  --query "DBInstances[?starts_with(DBInstanceIdentifier,'plate2home')].DBInstanceIdentifier" \
  --output text 2>/dev/null)"
for D in $DBS; do
  quiet aws rds delete-db-instance --db-instance-identifier "$D" \
    --skip-final-snapshot --delete-automated-backups
done

# --- 3. Auto Scaling group (it would keep starting new web servers) ------------------------
say "Auto Scaling group"
if quiet aws autoscaling delete-auto-scaling-group --auto-scaling-group-name plate2home-asg --force-delete; then
  wait_until 900 "the Auto Scaling group to go" bash -c \
    '[ "$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names plate2home-asg --query "length(AutoScalingGroups)" --output text)" = "0" ]'
fi

# --- 4. Load balancer, target group, launch template ---------------------------------------
say "Load balancer"
ALB="$(aws elbv2 describe-load-balancers --names plate2home-alb \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null)"
if [ -n "$ALB" ] && [ "$ALB" != "None" ]; then
  quiet aws elbv2 delete-load-balancer --load-balancer-arn "$ALB"
  quiet aws elbv2 wait load-balancers-deleted --load-balancer-arns "$ALB"
fi
TG="$(aws elbv2 describe-target-groups --names plate2home-tg \
  --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null)"
if [ -n "$TG" ] && [ "$TG" != "None" ]; then
  wait_until 300 "the target group to be free" aws elbv2 delete-target-group --target-group-arn "$TG"
fi
quiet aws ec2 delete-launch-template --launch-template-name plate2home-lt

# --- 5. Instances (build, web, anything named plate2home) ----------------------------------
say "EC2 instances"
IDS="$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=*plate2home*" Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[].Instances[].InstanceId' --output text)"
if [ -n "$IDS" ]; then
  quiet aws ec2 terminate-instances --instance-ids $IDS
  quiet aws ec2 wait instance-terminated --instance-ids $IDS
fi

# --- 6. Images and their snapshots ---------------------------------------------------------
say "AMIs and snapshots"
for AMI in $(aws ec2 describe-images --owners self --filters "Name=name,Values=*plate2home*" \
  --query 'Images[].ImageId' --output text); do
  SNAPS="$(aws ec2 describe-images --image-ids "$AMI" \
    --query 'Images[0].BlockDeviceMappings[].Ebs.SnapshotId' --output text)"
  quiet aws ec2 deregister-image --image-id "$AMI"
  for S in $SNAPS; do quiet aws ec2 delete-snapshot --snapshot-id "$S"; done
done

# --- 7. S3, Lambda, logs, SNS --------------------------------------------------------------
say "S3 buckets"
for B in $(aws s3api list-buckets \
  --query "Buckets[?starts_with(Name,'plate2home')].Name" --output text); do
  quiet aws s3 rb "s3://$B" --force
done
say "Lambda functions and their logs"
for F in plate2home-notify plate2home-cleanup; do
  quiet aws lambda delete-function --function-name "$F"
  quiet aws logs delete-log-group --log-group-name "/aws/lambda/$F"
done
say "SNS topic"
for T in $(aws sns list-topics --query "Topics[?contains(TopicArn,':plate2home')].TopicArn" \
  --output text); do
  quiet aws sns delete-topic --topic-arn "$T"
done

# --- 8. Wait for RDS, then its subnet group --------------------------------------------------
for D in $DBS; do
  wait_until 1500 "RDS $D to be deleted (up to 15 min)" bash -c \
    "! aws rds describe-db-instances --db-instance-identifier $D >/dev/null 2>&1"
done
say "DB subnet group"
quiet aws rds delete-db-subnet-group --db-subnet-group-name plate2home-db-subnets

# --- 9. Elastic IPs tagged plate2home -------------------------------------------------------
for A in $(aws ec2 describe-addresses --filters "Name=tag:Name,Values=*plate2home*" \
  --query 'Addresses[].AllocationId' --output text); do
  quiet aws ec2 release-address --allocation-id "$A"
done

# --- 10. Security groups (any VPC, also the old default-VPC ones) ---------------------------
say "Security groups"
SGS="$(aws ec2 describe-security-groups --filters "Name=group-name,Values=*plate2home*" \
  --query 'SecurityGroups[].GroupId' --output text)"
# Drop their rules first: they point at each other, which blocks deleting them.
for G in $SGS; do
  IN="$(aws ec2 describe-security-groups --group-ids "$G" --query 'SecurityGroups[0].IpPermissions' --output json)"
  OUT="$(aws ec2 describe-security-groups --group-ids "$G" --query 'SecurityGroups[0].IpPermissionsEgress' --output json)"
  [ "$IN" != "[]" ] && quiet aws ec2 revoke-security-group-ingress --group-id "$G" --ip-permissions "$IN"
  [ "$OUT" != "[]" ] && quiet aws ec2 revoke-security-group-egress --group-id "$G" --ip-permissions "$OUT"
done
for G in $SGS; do
  # Network interfaces of the load balancer and RDS can take a few minutes to disappear.
  wait_until 600 "security group $G to be free" aws ec2 delete-security-group --group-id "$G"
done

# --- 11. The VPC and what is inside it ------------------------------------------------------
say "VPC"
for VPC in $(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=*plate2home*" \
  --query 'Vpcs[].VpcId' --output text); do
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
    wait_until 600 "subnet $S to be free" aws ec2 delete-subnet --subnet-id "$S"
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
  wait_until 300 "VPC $VPC to be deleted" aws ec2 delete-vpc --vpc-id "$VPC"
done

# --- 12. Local working files in CloudShell ---------------------------------------------------
rm -rf "$HOME/plate2home-iac" /tmp/plate2home-tofu

# --- What is left? ---------------------------------------------------------------------------
echo
echo "Left over (should all be empty):"
echo "  instances:  $(aws ec2 describe-instances --filters "Name=tag:Name,Values=*plate2home*" Name=instance-state-name,Values=pending,running,stopping,stopped --query 'Reservations[].Instances[].InstanceId' --output text)"
echo "  RDS:        $(aws rds describe-db-instances --query "DBInstances[?starts_with(DBInstanceIdentifier,'plate2home')].DBInstanceIdentifier" --output text)"
echo "  ALB:        $(aws elbv2 describe-load-balancers --query "LoadBalancers[?starts_with(LoadBalancerName,'plate2home')].LoadBalancerName" --output text)"
echo "  S3:         $(aws s3api list-buckets --query "Buckets[?starts_with(Name,'plate2home')].Name" --output text)"
echo "  VPC:        $(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=*plate2home*" --query 'Vpcs[].VpcId' --output text)"
echo "If something is still listed, run this script again in a few minutes."
echo "RESET DONE"
