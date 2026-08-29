#!/bin/bash

# ScribeTribe - Setup Script
# Installs dependencies, creates config, and prints launch instructions.
# The backend serves both the API and the frontend, so there is only one server.

set -e

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

# Install dependencies (backend runtime + test tooling for both)
echo "📦 Installing backend dependencies..."
cd backend && npm install && cd ..

echo "📦 Installing frontend test tooling..."
cd frontend && npm install && cd ..

echo "📦 Installing e2e tooling (Playwright)..."
cd e2e && npm install && cd ..

# Database + config
mkdir -p database

if [ ! -f "backend/.env" ]; then
    echo "📝 Creating backend/.env from the example..."
    cp backend/.env.example backend/.env
    echo "🔑 Next: edit backend/.env and set OPENROUTER_API_KEY"
fi

# Convenience launcher
chmod +x start.sh

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit backend/.env - set OPENROUTER_API_KEY"
echo "  2. ./start.sh   (or: cd backend && npm start)"
echo "  3. Browse to http://localhost:3000"
echo ""
echo "Tests:"
echo "  npm test           # backend + frontend unit/integration (Jest)"
echo "  npm run test:e2e   # browser tests (needs: cd e2e && npx playwright install chromium firefox)"