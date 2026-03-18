#!/bin/bash

# Rex Memory Service — Deployment Script
# Deploys to aux.frostdesigngroup.com/rex

# Variables
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_USER="root"
DEST_HOST="178.128.127.92"
DEST_PORT="22443"
DEST_DIR="/mnt/volume_sgp1_01/aux/rex"
SSH_KEY="~/.ssh/id_rsa"
SSH_CMD="ssh -q -i ${SSH_KEY} -p ${DEST_PORT} ${DEST_USER}@${DEST_HOST}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Deploying Rex Memory Service...${NC}"
echo ""

# ─── Step 1: Ensure remote directory exists ──────────────────────────────────

echo -e "${YELLOW}[1/4] Creating remote directories...${NC}"
${SSH_CMD} "mkdir -p ${DEST_DIR}"

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to create remote directory${NC}"
    exit 1
fi
echo -e "${GREEN}Done${NC}"

# ─── Step 2: Sync app code ──────────────────────────────────────────────────

echo ""
echo -e "${YELLOW}[2/4] Syncing code to server...${NC}"
rsync -avz --progress \
  -e "ssh -q -i ${SSH_KEY} -p ${DEST_PORT}" \
  --include='server.js' \
  --include='package.json' \
  --include='package-lock.json' \
  --include='src/' \
  --include='src/**' \
  --include='frontend/' \
  --include='frontend/**' \
  --exclude='.env' \
  --exclude='node_modules' \
  --exclude='*' \
  "${SRC_DIR}/" ${DEST_USER}@${DEST_HOST}:${DEST_DIR}/

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Code synced successfully${NC}"
else
    echo -e "${RED}Code sync failed${NC}"
    exit 1
fi

# ─── Step 3: Install dependencies ───────────────────────────────────────────

echo ""
echo -e "${YELLOW}[3/4] Installing production dependencies...${NC}"
${SSH_CMD} "source ~/.nvm/nvm.sh && cd ${DEST_DIR} && npm install --production"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Dependencies installed${NC}"
else
    echo -e "${RED}Dependency installation failed${NC}"
    exit 1
fi

# ─── Step 4: Check .env and restart PM2 ─────────────────────────────────────

echo ""
echo -e "${YELLOW}[4/4] Checking .env and restarting service...${NC}"
${SSH_CMD} "
if [ ! -f ${DEST_DIR}/.env ]; then
    echo 'Creating default .env...'
    cat > ${DEST_DIR}/.env << 'ENVEOF'
PORT=3940
BASE_PATH=/rex
MONGODB_URI=mongodb://localhost:27017
DB_NAME=rex
ENVEOF
    echo '.env created'
else
    echo '.env already exists'
fi
"

${SSH_CMD} "source ~/.nvm/nvm.sh && cd ${DEST_DIR} && pm2 restart rex-memory --update-env 2>/dev/null || pm2 start server.js --name rex-memory -- --env production && pm2 save"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}PM2 service restarted${NC}"
else
    echo -e "${RED}Failed to restart PM2 service${NC}"
    exit 1
fi

# ─── Done ────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}Deployment complete!${NC}"
echo ""
echo -e "${BLUE}Production .env (${DEST_DIR}/.env):${NC}"
echo "   PORT=3940"
echo "   BASE_PATH=/rex"
echo "   MONGODB_URI=mongodb://localhost:27017"
echo "   DB_NAME=rex"
echo ""
echo -e "${BLUE}Verification:${NC}"
echo "   curl https://aux.frostdesigngroup.com/rex/api/health"
echo "   curl https://aux.frostdesigngroup.com/rex/api/stats"
echo "   Dashboard: https://aux.frostdesigngroup.com/rex/frontend/"
echo ""
echo -e "${BLUE}PM2:${NC}"
echo "   pm2 status rex-memory"
echo "   pm2 logs rex-memory"
echo ""
