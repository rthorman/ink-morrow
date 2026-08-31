#!/bin/bash
# Convenience launcher: serves app + API on http://localhost:3000
set -e
cd "$(dirname "$0")/backend"
exec npm start