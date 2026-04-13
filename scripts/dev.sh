#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."

echo "building backend..."
cargo build -p cellforge-server

echo ""
echo "starting cellforge..."
echo "  backend:  http://127.0.0.1:8888"
echo "  frontend: http://localhost:3000"
echo ""

trap 'kill 0' EXIT

# if no args given, default to current dir
if [ $# -eq 0 ]; then
    cargo run -p cellforge-server -- --notebook-dir . &
else
    cargo run -p cellforge-server -- "$@" &
fi

sleep 2
(cd frontend && npx vite --host) &

wait
