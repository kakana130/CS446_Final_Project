#!/usr/bin/env bash
# First-time setup on the EC2 instance (Amazon Linux 2023). Run from the project folder:
#   bash aws/ec2/setup.sh
# It installs Node.js 24, adds swap (so `next build` fits on a small instance), downloads the
# RDS certificate bundle, applies the database schema to RDS, builds the app and runs it as a
# systemd service on port 3000 (CloudFront's origin). Safe to run again.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_USER="$(id -un)"
cd "$APP_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  echo ">> Created $APP_DIR/.env. Fill it in (AWS-DEPLOY.md, step 7), then run this script again."
  exit 1
fi

echo ">> Swap (2 GB)"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile swap swap defaults 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo ">> Node.js 24"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v24.* ]]; then
  case "$(uname -m)" in
    x86_64) ARCH=x64 ;;
    aarch64) ARCH=arm64 ;;
    *) echo "Unsupported CPU $(uname -m)"; exit 1 ;;
  esac
  BASE=https://nodejs.org/dist/latest-v24.x
  TMP="$(mktemp -d)"
  curl -fsSL "$BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  FILE="$(grep -o "node-v24[0-9.]*-linux-$ARCH\.tar\.xz" "$TMP/SHASUMS256.txt" | head -1)"
  curl -fsSL "$BASE/$FILE" -o "$TMP/$FILE"
  (cd "$TMP" && grep " $FILE\$" SHASUMS256.txt | sha256sum -c -)
  sudo tar -xJf "$TMP/$FILE" -C /usr/local --strip-components=1
  rm -rf "$TMP"
fi
node -v

echo ">> Amazon RDS certificate bundle"
curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o rds-global-bundle.pem

echo ">> Dependencies"
npm ci --no-audit --no-fund

echo ">> Database schema (Amazon RDS)"
npm run db:migrate

echo ">> Build"
npm run build

echo ">> systemd service plate2home"
sed -e "s#__APP_DIR__#$APP_DIR#g" -e "s#__APP_USER__#$APP_USER#g" aws/ec2/plate2home.service \
  | sudo tee /etc/systemd/system/plate2home.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable plate2home >/dev/null
sudo systemctl restart plate2home

echo ">> Waiting for the app on port 3000"
for _ in $(seq 1 30); do
  if curl -fs -o /dev/null http://127.0.0.1:3000/; then
    echo ">> Plate2Home is running on port 3000."
    exit 0
  fi
  sleep 2
done
echo "!! The app did not answer. Check: sudo journalctl -u plate2home -n 50"
exit 1
