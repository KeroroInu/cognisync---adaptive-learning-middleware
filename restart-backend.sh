#!/bin/bash

# Kill existing backend process
lsof -ti:8000 | xargs kill -9 2>/dev/null
echo "Killed existing backend process"

# Start backend
cd backend
source venv/bin/activate
nohup uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 > /tmp/cognisync-backend.log 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > /tmp/cognisync-backend.pid
echo "Backend started with PID: $BACKEND_PID"
echo "Backend running at http://localhost:8000"
echo "API docs at http://localhost:8000/docs"

# Wait a moment and check status
sleep 2
if lsof -i:8000 | grep -q LISTEN; then
    echo "✓ Backend is running successfully"
else
    echo "✗ Backend failed to start. Check logs at /tmp/cognisync-backend.log"
    tail -20 /tmp/cognisync-backend.log
fi
