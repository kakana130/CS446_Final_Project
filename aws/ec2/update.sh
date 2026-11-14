#!/usr/bin/env bash
# Build a new version on the build instance: pull, install, migrate, build, restart.
#   bash aws/ec2/update.sh
# Also run it after changing NEXT_PUBLIC_* values in .env (they are built into the pages).
# Run it on the build instance only, never on the Auto Scaling instances: every build names its
# page assets differently, so instances built separately would serve pages that don't fit
# together behind the load balancer. Roll the build out with a new AMI and an instance refresh
# (AWS-DEPLOY.md, "Deploying a new version").
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
git pull --ff-only
npm ci --no-audit --no-fund
npm run db:migrate
npm run build
sudo systemctl restart plate2home
echo ">> Built and running on this instance. Logs: sudo journalctl -u plate2home -f"
echo ">> To put it live: create a new AMI from this instance, then start an instance refresh."
