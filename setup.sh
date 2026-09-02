#!/bin/bash

# Ink Morrow - Setup Script
# Updates dependencies, creates config, and prints launch instructions.
# The backend serves both the API and the frontend, so there is only one server.

set -e
umask 077

DEV_SETUP=0
CLEAN_SETUP=0

usage() {
    echo "Usage: ./setup.sh [--dev] [--clean]"
    echo "  --dev    Include lint, Jest, and Playwright tooling."
    echo "  --clean  Replace the selected node_modules directories from lockfiles."
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --dev) DEV_SETUP=1 ;;
        --clean) CLEAN_SETUP=1 ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            usage
            exit 2
            ;;
    esac
    shift
done

echo "🐱📜 Ink Morrow Setup 🐱📜"
echo "================================"

if [ ! -f "backend/package.json" ]; then
    echo "❌ Run this script from the ink-morrow root directory"
    exit 1
fi

# Prerequisites
for cmd in node npm; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "❌ $cmd is not installed. Install Node.js >= 22.5 first."
        exit 1
    fi
done

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 5) ? 0 : 1)'; then
    echo "❌ Node >= 22.5 is required (built-in node:sqlite). Found: $(node --version)"
    exit 1
fi
echo "✅ Node $(node --version)"

# A normal installation needs only the backend runtime. The frontend is
# static and has no build step; developer/Jest/Playwright tools are opt-in.
# Existing dependency trees are updated in place. A clean replacement is a
# separate, explicit operation because npm ci always removes node_modules.
INSTALL_DIRS=(backend)
if [ "$DEV_SETUP" -eq 1 ]; then
    INSTALL_DIRS=(backend . frontend e2e)
fi

modules_target() {
    if [ "$1" = "." ]; then
        printf '%s/node_modules' "$PROJECT_ROOT"
    else
        printf '%s/%s/node_modules' "$PROJECT_ROOT" "$1"
    fi
}

refuse_linked_modules() {
    local target
    target=$(modules_target "$1")
    if [ -L "$target" ]; then
        echo "❌ Refusing to modify linked dependency directory: $target"
        echo "   Replace it with a real directory or manage its dependencies manually."
        exit 1
    fi
}

install_package() {
    local directory="$1"
    shift
    local target
    target=$(modules_target "$directory")
    refuse_linked_modules "$directory"

    if [ "$CLEAN_SETUP" -eq 1 ]; then
        (cd "$directory" && npm ci "$@")
    elif [ -d "$target" ]; then
        (cd "$directory" && npm install "$@")
    else
        # With no existing tree there is nothing to erase, so use the exact
        # lockfile install without turning an ordinary rerun into a reset.
        (cd "$directory" && npm ci "$@")
    fi
}

PROJECT_ROOT=$(pwd -P)
if [ "$CLEAN_SETUP" -eq 1 ]; then
    echo "⚠️  Clean dependency replacement requested. npm ci will replace:"
    for directory in "${INSTALL_DIRS[@]}"; do
        echo "   - $(modules_target "$directory")"
        refuse_linked_modules "$directory"
    done
fi

echo "📦 Updating backend dependencies..."
if [ "$DEV_SETUP" -eq 1 ]; then
    install_package backend
    echo "📦 Updating root and frontend test tooling..."
    install_package .
    install_package frontend
    echo "📦 Updating Playwright test tooling (browser binaries remain separate)..."
    install_package e2e
else
    install_package backend --omit=dev
fi

# Database + config
mkdir -p -m 700 database
chmod 700 database 2>/dev/null || true

if [ ! -f "backend/.env" ]; then
    echo "📝 Creating backend/.env from the example..."
    cp backend/.env.example backend/.env
    chmod 600 backend/.env 2>/dev/null || true
    echo "🔑 Next: edit backend/.env and set OPENROUTER_API_KEY"
fi
chmod 600 backend/.env 2>/dev/null || true

# Convenience launcher
chmod +x start.sh

echo ""
echo "🎉 Setup complete!"
echo ""
if [ -f "database/ink-morrow.db" ]; then
    echo "⚠️  Ink Morrow 4.0 will not reinterpret an existing 3.x database."
    echo "   Set DATA_DIR=../database-v4 in backend/.env for a clean 4.0 store,"
    echo "   or keep this directory on the historical 3.2.2 build. The old file is not changed."
    echo ""
fi
echo "Next steps:"
echo "  1. Edit backend/.env - set OPENROUTER_API_KEY"
echo "  2. ./start.sh   (or: cd backend && npm start)"
echo "  3. Browse to http://localhost:3000"
echo "  4. On first login, enter the one-time setup code printed by the server"
echo ""
if [ "$DEV_SETUP" -eq 1 ]; then
    echo "Tests:"
    echo "  npm test           # backend + frontend unit/integration (Jest)"
    echo "  npm run test:e2e   # browser tests (install a supported Chromium separately)"
else
    echo "Developer tooling was skipped. Use ./setup.sh --dev on a development checkout."
fi
