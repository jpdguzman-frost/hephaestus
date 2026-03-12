#!/bin/bash

# Rex Memory Service Deployment Script
# Deploys to aux.frostdesigngroup.com/rex

# Variables
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_USER="root"
DEST_HOST="178.128.127.92"
DEST_PORT="22443"
DEST_DIR="/mnt/volume_sgp1_01/aux/rex"
SSH_KEY="~/.ssh/id_ed25519"
SSH_CMD="ssh -i ${SSH_KEY} -p ${DEST_PORT} ${DEST_USER}@${DEST_HOST}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Starting Rex Memory Service Deployment...${NC}"

# ─── Step 0: Create remote directories ─────────────────────────────────────

echo -e "${YELLOW}Creating remote directories...${NC}"
${SSH_CMD} "mkdir -p ${DEST_DIR}"

# ─── Step 1: Sync app code ─────────────────────────────────────────────────

echo -e "${YELLOW}Syncing app code to server...${NC}"
rsync -avz --progress \
  -e "ssh -i ${SSH_KEY} -p ${DEST_PORT}" \
  --include='server.js' \
  --include='package.json' \
  --include='package-lock.json' \
  --include='src/' \
  --include='src/**' \
  --include='frontend/' \
  --include='frontend/**' \
  --include='.env' \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='*' \
  "${SRC_DIR}/" "${DEST_USER}@${DEST_HOST}:${DEST_DIR}/"

if [ $? -ne 0 ]; then
  echo -e "${RED}Rsync failed!${NC}"
  exit 1
fi
echo -e "${GREEN}Code synced.${NC}"

# ─── Step 2: Install dependencies ─────────────────────────────────────────

echo -e "${YELLOW}Installing dependencies...${NC}"
${SSH_CMD} "cd ${DEST_DIR} && npm install --production"

if [ $? -ne 0 ]; then
  echo -e "${RED}npm install failed!${NC}"
  exit 1
fi
echo -e "${GREEN}Dependencies installed.${NC}"

# ─── Step 3: Check .env ───────────────────────────────────────────────────

echo -e "${YELLOW}Checking config...${NC}"
${SSH_CMD} "test -f ${DEST_DIR}/.env" 2>/dev/null
if [ $? -ne 0 ]; then
  echo -e "${RED}WARNING: No .env file found on server!${NC}"
  echo -e "${YELLOW}Create one at ${DEST_DIR}/.env with:${NC}"
  echo "  PORT=3002"
  echo "  BASE_PATH=/rex"
  echo "  MONGODB_URI=mongodb://localhost:27017"
  echo "  DB_NAME=rex_memory"
fi

# ─── Step 4: Restart PM2 ──────────────────────────────────────────────────

echo -e "${YELLOW}Restarting service...${NC}"
${SSH_CMD} "cd ${DEST_DIR} && (pm2 restart rex-memory --update-env 2>/dev/null || pm2 start server.js --name rex-memory && pm2 save)"

if [ $? -ne 0 ]; then
  echo -e "${RED}PM2 restart failed!${NC}"
  exit 1
fi

# ─── Step 5: Verify ───────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}Deployment complete!${NC}"
echo ""
echo -e "  Dashboard: ${BLUE}https://aux.frostdesigngroup.com/rex/frontend/${NC}"
echo -e "  API:       ${BLUE}https://aux.frostdesigngroup.com/rex/api/health${NC}"
echo -e "  PM2:       ${YELLOW}pm2 status rex-memory${NC}"
echo -e "  Logs:      ${YELLOW}pm2 logs rex-memory${NC}"
echo ""
