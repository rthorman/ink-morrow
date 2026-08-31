#!/bin/bash

# ScribeTribe - Setup Script
# Installs dependencies, creates config, and prints launch instructions.
# The backend serves both the API and the frontend, so there is only one server.

set -e
umask 077

DEV_SETUP=0
if [ "${1:-}" = "--dev" ]; then
    DEV_SETUP=1
elif [ -n "${1:-}" ]; then
    echo "Usage: ./setup.sh [--dev]"
    exit 2
fi

echo "🐱📜 ScribeTribe Setup 🐱📜"
echo "================================"

if [ ! -f "backend/package.json" ]; then
    echo "❌ Run this script from the scribe-tribe root directory"
    exit 1
fi

# Prerequisites
for cmd in node npm; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "❌ $cmd is not installed. Install Node.js >= 22.5 first."
        exit 1
    fi
done

NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 22 ]; then
    echo "❌ Node >= 22.5 is required (built-in node:sqlite). Found: $(node --version)"
    exit 1
fi
echo "✅ Node $(node --version)"

# A normal installation needs only the backend runtime. The frontend is
# static and has no build step; developer/Jest/Playwright tools are opt-in.
echo "📦 Installing backend dependencies..."
if [ "$DEV_SETUP" -eq 1 ]; then
    (cd backend && npm ci)
    echo "📦 Installing root and frontend test tooling..."
    npm ci
    (cd frontend && npm ci)
    echo "📦 Installing Playwright test tooling (browser binaries remain separate)..."
    (cd e2e && npm ci)
else
    (cd backend && npm ci --omit=dev)
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
