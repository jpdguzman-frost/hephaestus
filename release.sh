#!/bin/bash

# Rex — Build & Package Release
# Builds server + plugin and packages into rex-dist/ and releases/

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$SCRIPT_DIR/rex-dist"
RELEASES_DIR="$SCRIPT_DIR/releases"

# Read version from package.json
VERSION=$(node -e "console.log(require('./package.json').version)")

echo -e "${BLUE}Building Rex v${VERSION}...${NC}"
echo ""

# ─── Step 1: Build ──────────────────────────────────────────────────────────

echo -e "${YELLOW}[1/3] Building server + plugin...${NC}"
npm run build

echo -e "${GREEN}Build complete${NC}"
echo ""

# ─── Step 2: Package into rex-dist/ ─────────────────────────────────────────

echo -e "${YELLOW}[2/3] Packaging to rex-dist/...${NC}"

# Server
rm -rf "$DIST_DIR/server"
mkdir -p "$DIST_DIR/server"
cp -r "$SCRIPT_DIR/dist/"* "$DIST_DIR/server/"
cp "$SCRIPT_DIR/package.json" "$DIST_DIR/server/package.json"
cp "$SCRIPT_DIR/package-lock.json" "$DIST_DIR/server/package-lock.json"

# Plugin
rm -rf "$DIST_DIR/plugin"
mkdir -p "$DIST_DIR/plugin"
cp "$SCRIPT_DIR/plugin/code.js" "$DIST_DIR/plugin/code.js"
cp "$SCRIPT_DIR/plugin/manifest.json" "$DIST_DIR/plugin/manifest.json"
cp "$SCRIPT_DIR/plugin/ui.html" "$DIST_DIR/plugin/ui.html"

echo -e "${GREEN}rex-dist/ packaged${NC}"
echo ""

# ─── Step 3: Create release zip ─────────────────────────────────────────────

echo -e "${YELLOW}[3/3] Creating release archive...${NC}"

mkdir -p "$RELEASES_DIR"
RELEASE_FILE="$RELEASES_DIR/rex_${VERSION}.zip"

cd "$DIST_DIR"
zip -r "$RELEASE_FILE" . -x "*.DS_Store"
cd "$SCRIPT_DIR"

echo -e "${GREEN}Release: ${RELEASE_FILE}${NC}"
echo ""

# ─── Done ────────────────────────────────────────────────────────────────────

echo -e "${GREEN}Rex v${VERSION} packaged successfully!${NC}"
echo ""
echo -e "${BLUE}Contents:${NC}"
echo "   rex-dist/server/   — MCP server (node dist)"
echo "   rex-dist/plugin/   — Figma plugin"
echo "   rex-dist/install.sh — Installer"
echo "   releases/rex_${VERSION}.zip"
echo ""
