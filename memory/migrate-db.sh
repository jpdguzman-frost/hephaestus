#!/bin/bash

# Rex Memory Service — MongoDB Migration Script
# Exports local DB and imports to production server

DEST_USER="root"
DEST_HOST="178.128.127.92"
DEST_PORT="22443"
DEST_DIR="/mnt/volume_sgp1_01/aux/rex"
SSH_KEY="~/.ssh/id_ed25519"
SSH_CMD="ssh -i ${SSH_KEY} -p ${DEST_PORT} ${DEST_USER}@${DEST_HOST}"

LOCAL_DB="rex"
REMOTE_DB="rex"
DUMP_DIR="/tmp/rex-dump"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Rex Memory — MongoDB Migration${NC}"
echo ""

# ─── Step 1: Dump local database ────────────────────────────────────────────

echo -e "${YELLOW}Step 1: Export local MongoDB (${LOCAL_DB})${NC}"
echo "   This will run: mongodump --db=${LOCAL_DB} --out=${DUMP_DIR}"
echo ""
read -p "Continue? [y/N]: " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

rm -rf ${DUMP_DIR}
mongodump --db=${LOCAL_DB} --out=${DUMP_DIR}

if [ $? -ne 0 ]; then
    echo -e "${RED}mongodump failed${NC}"
    exit 1
fi

COLLECTION_COUNT=$(ls ${DUMP_DIR}/${LOCAL_DB}/*.bson 2>/dev/null | wc -l | tr -d ' ')
echo -e "${GREEN}Exported ${COLLECTION_COUNT} collection(s) to ${DUMP_DIR}/${LOCAL_DB}${NC}"
echo ""

# ─── Step 2: Upload dump to server ──────────────────────────────────────────

echo -e "${YELLOW}Step 2: Upload dump to server${NC}"
echo "   Target: ${DEST_HOST}:/tmp/rex-dump/"
echo ""
read -p "Continue? [y/N]: " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

rsync -avz --progress \
  -e "ssh -i ${SSH_KEY} -p ${DEST_PORT}" \
  ${DUMP_DIR}/ ${DEST_USER}@${DEST_HOST}:/tmp/rex-dump/

if [ $? -ne 0 ]; then
    echo -e "${RED}Upload failed${NC}"
    exit 1
fi
echo -e "${GREEN}Dump uploaded${NC}"
echo ""

# ─── Step 3: Restore on remote server ───────────────────────────────────────

echo -e "${YELLOW}Step 3: Restore to remote MongoDB (${REMOTE_DB})${NC}"
echo "   This will run: mongorestore --db=${REMOTE_DB} /tmp/rex-dump/${LOCAL_DB}"
echo "   NOTE: Existing documents with same _id will be skipped (use --drop to replace)"
echo ""
read -p "Continue? [y/N]: " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

${SSH_CMD} "mongorestore --db=${REMOTE_DB} /tmp/rex-dump/${LOCAL_DB}"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Database restored successfully${NC}"
else
    echo -e "${RED}Restore failed${NC}"
    exit 1
fi

# ─── Step 4: Cleanup ────────────────────────────────────────────────────────

echo ""
echo -e "${YELLOW}Cleaning up local dump...${NC}"
rm -rf ${DUMP_DIR}

echo ""
echo -e "${GREEN}Migration complete!${NC}"
echo ""
echo -e "${BLUE}Verify:${NC}"
echo "   curl https://aux.frostdesigngroup.com/rex/api/stats"
echo ""
