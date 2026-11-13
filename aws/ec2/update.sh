#!/usr/bin/env bash
# Deploy a new version on the EC2 instance: pull, install, migrate, build, restart.
#   bash aws/ec2/update.sh
# Also run it after changing NEXT_PUBLIC_* values in .env (they are built into the pages).
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
git pull --ff-only
npm ci --no-audit --no-fund
npm run db:migrate
npm run build
sudo systemctl restart plate2home
echo ">> Updated. Logs: sudo journalctl -u plate2home -f"
