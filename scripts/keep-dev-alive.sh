#!/bin/bash
# Keep the dev server running persistently
cd /home/z/my-project
unset DATABASE_URL
while true; do
  echo "[$(date)] Starting dev server..."
  bun run dev >> /home/z/my-project/dev.log 2>&1
  echo "[$(date)] Dev server exited, restarting in 3s..."
  sleep 3
done
