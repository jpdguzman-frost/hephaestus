#!/bin/bash
# ============================================================
#  Rex Installer — One-command setup for macOS
# ============================================================

set -e

# Colors
GOLD='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${GOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${GOLD}║          Rex Installer v0.3          ║${NC}"
echo -e "${GOLD}╚══════════════════════════════════════╝${NC}"
echo ""

# ── Step 0: Locate ourselves ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"
PLUGIN_DIR="$SCRIPT_DIR/plugin"

# ── Step 1: Check Node.js ──
echo -e "${BOLD}[1/4] Checking Node.js...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js is not installed.${NC}"
    echo ""
    echo "  Please install Node.js first. The easiest way:"
    echo ""
    echo "    1. Go to https://nodejs.org"
    echo "    2. Download the LTS version (green button)"
    echo "    3. Run the installer"
    echo "    4. Re-run this script"
    echo ""
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo -e "${RED}✗ Node.js v20+ is required (you have $(node -v))${NC}"
    echo "  Please update from https://nodejs.org"
    exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v) detected${NC}"

# ── Step 2: Install dependencies ──
echo ""
echo -e "${BOLD}[2/4] Installing server dependencies...${NC}"
cd "$SERVER_DIR"
npm install --production --silent 2>&1 | tail -1
echo -e "${GREEN}✓ Dependencies installed${NC}"

# ── Step 3: Determine install location ──
INSTALL_DIR="$HOME/rex"
echo ""
echo -e "${BOLD}[3/4] Installing Rex to ${INSTALL_DIR}...${NC}"

# Copy server
mkdir -p "$INSTALL_DIR/server"
cp -r "$SERVER_DIR/"* "$INSTALL_DIR/server/"

# Copy plugin
mkdir -p "$INSTALL_DIR/plugin"
cp -r "$PLUGIN_DIR/"* "$INSTALL_DIR/plugin/"

echo -e "${GREEN}✓ Rex installed to ${INSTALL_DIR}${NC}"

# ── Step 4: Print configuration ──
REX_SERVER_PATH="$INSTALL_DIR/server/index.js"

echo ""
echo -e "${BOLD}[4/4] Almost done! Two things left:${NC}"
echo ""
echo -e "${GOLD}━━━ A) Add Rex to your AI client ━━━${NC}"
echo ""
echo "  Copy the JSON below and paste it into your AI client's MCP config."
echo ""
echo -e "  ${DIM}Claude Desktop: Settings → Developer → Edit Config${NC}"
echo -e "  ${DIM}Cursor:         Settings → MCP Servers → Add${NC}"
echo -e "  ${DIM}Windsurf:       Settings → MCP → Add Server${NC}"
echo ""
echo -e "${GOLD}┌──────────────────────────────────────────────────────────┐${NC}"
cat <<JSONEOF
  {
    "mcpServers": {
      "rex": {
        "command": "node",
        "args": ["$REX_SERVER_PATH"]
      }
    }
  }
JSONEOF
echo -e "${GOLD}└──────────────────────────────────────────────────────────┘${NC}"
echo ""
echo -e "${GOLD}━━━ B) Import the Figma Plugin ━━━${NC}"
echo ""
echo "  1. Open Figma Desktop"
echo "  2. Go to: Menu → Plugins → Development → Import plugin from manifest..."
echo "  3. Navigate to: ${INSTALL_DIR}/plugin/manifest.json"
echo "  4. Click Open"
echo ""
echo -e "${GREEN}━━━ You're all set! ━━━${NC}"
echo ""
echo "  To use Rex:"
echo "    1. Open a Figma file"
echo "    2. Run the Rex plugin (Plugins → Development → Rex)"
echo "    3. Start your AI client — it will connect automatically"
echo ""
echo -e "  ${DIM}Need help? Open setup-guide.html in your browser.${NC}"
echo ""
