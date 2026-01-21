#!/bin/bash

cd "$(dirname "$0")"

LOG_FILE="server.log"

# Kill existing server if running
if [ -f .server.pid ]; then
    PID=$(cat .server.pid)
    if kill -0 "$PID" 2>/dev/null; then
        kill "$PID"
        echo "Stopped existing server (PID: $PID)"
        sleep 1
    fi
    rm -f .server.pid
else
    # Try to find and kill uvicorn on port 6969
    PID=$(lsof -ti:6969 2>/dev/null)
    if [ -n "$PID" ]; then
        kill "$PID"
        echo "Killed existing process on port 6969 (PID: $PID)"
        sleep 1
    fi
fi

# Load environment variables from .env file
if [ -f .env ]; then
    set -a
    source .env
    set +a
else
    echo "Warning: .env file not found. Copy .env.example to .env and configure it."
    exit 1
fi

# Activate virtual environment and start server in background
source .venv/bin/activate
nohup uvicorn app.main:app --port 6969 --log-config log_config.json >> "$LOG_FILE" 2>&1 &
echo $! > .server.pid
echo "Server started on http://127.0.0.1:6969 (PID: $(cat .server.pid))"
echo "Logs: $LOG_FILE"