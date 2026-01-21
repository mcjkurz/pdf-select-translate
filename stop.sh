#!/bin/bash

cd "$(dirname "$0")"

if [ -f .server.pid ]; then
    PID=$(cat .server.pid)
    if kill -0 "$PID" 2>/dev/null; then
        kill "$PID"
        echo "Server stopped (PID: $PID)"
    else
        echo "Server not running (stale PID file)"
    fi
    rm -f .server.pid
else
    echo "No PID file found. Server may not be running."
    # Try to find and kill uvicorn on port 6969
    PID=$(lsof -ti:6969 2>/dev/null)
    if [ -n "$PID" ]; then
        kill "$PID"
        echo "Killed process on port 6969 (PID: $PID)"
    fi
fi
