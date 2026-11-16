#!/usr/bin/env bash
# Quick setup, part 1 — run in AWS CloudShell (us-east-1) after the VPC, the security groups
# and the plate2home-build instance exist:
#   bash ~/CS446_Final_Project/aws/iac/quick/1-create.sh
# Installs OpenTofu, makes a random RDS password, and applies aws/iac/00–07 (RDS, S3, SNS,
# both Lambdas, EventBridge, ALB). Then prints the block to paste on the build instance.
# Safe to run again: it creates only what is missing and prints the block again.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK="$HOME/plate2home-iac"
TOFU_VERSION=1.13.9
export AWS_DEFAULT_REGION=us-east-1
export PATH="$HOME/.local/bin:$PATH"
# Provider plugins (the AWS one is ~700 MB) go to /tmp: CloudShell's home folder holds only
# 1 GB. The state stays in $WORK; `tofu init` fetches the plugins again in a new session.
export TF_DATA_DIR=/tmp/plate2home-tofu

if ! command -v tofu >/dev/null 2>&1; then
  echo ">> Installing OpenTofu $TOFU_VERSION"
  arch="$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')"
  curl -fsSLo /tmp/tofu.zip \
    "https://github.com/opentofu/opentofu/releases/download/v$TOFU_VERSION/tofu_${TOFU_VERSION}_linux_$arch.zip"
  mkdir -p "$HOME/.local/bin"
  unzip -oq /tmp/tofu.zip tofu -d "$HOME/.local/bin"
  rm -f /tmp/tofu.zip
  grep -q '.local/bin' "$HOME/.bashrc" || echo 'export PATH=$HOME/.local/bin:$PATH' >>"$HOME/.bashrc"
fi
tofu version | sed -n 1p

mkdir -p "$WORK"
cd "$WORK"
rm -rf "$WORK/.terraform" # plugins from an older run, now kept in TF_DATA_DIR
# RDS master password: random letters and digits, kept only in this folder.
[ -f terraform.tfvars ] || echo "db_password = \"$(openssl rand -hex 16)\"" >terraform.tfvars
cp "$REPO"/aws/iac/0[0-7]-*.tf .

# Instances in the public subnets need a public address to reach S3 and Lambda.
for N in public1 public2; do
  SUBNET="$(aws ec2 describe-subnets --filters "Name=tag:Name,Values=plate2home-subnet-$N-*" \
    --query 'Subnets[0].SubnetId' --output text)"
  if [ "$SUBNET" = "None" ]; then
    echo "!! No subnet plate2home-subnet-$N-*. Create the VPC with Name tag 'plate2home' first."
    exit 1
  fi
  aws ec2 modify-subnet-attribute --subnet-id "$SUBNET" --map-public-ip-on-launch
done

echo ">> Creating RDS, S3, SNS, Lambda x2, EventBridge and the load balancer (about 10 minutes)"
tofu init -input=false >/dev/null
# Older 02-s3.tf used aws_s3_bucket, which Learner Lab can't read back. Forget it here (the
# bucket itself stays and is adopted by the new 02-s3.tf).
STATE="$(tofu state list 2>/dev/null || true)"
for R in aws_s3_bucket_public_access_block.crops aws_s3_bucket.crops; do
  case $'\n'"$STATE"$'\n' in
    *$'\n'"$R"$'\n'*) tofu state rm "$R" >/dev/null && echo ">> Removed old $R from the state" ;;
  esac
done
tofu apply -auto-approve -input=false -var "repo_dir=$REPO"

CLONE_URL="$(git -C "$REPO" remote get-url origin)"
echo
echo "=================== COPY FROM THE NEXT LINE ==================="
cat <<EOF
sudo dnf install -y git
sudo mkdir -p /opt/plate2home
sudo chown ec2-user /opt/plate2home
git clone $CLONE_URL /opt/plate2home
cp /opt/plate2home/.env.example /opt/plate2home/.env
EOF
tofu output -raw env_commands
echo "bash aws/ec2/setup.sh"
echo "=================== TO THE LINE ABOVE ==================="
echo
echo "Website address: $(tofu output -raw site_url)"
echo "PART 1 DONE"
