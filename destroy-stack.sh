#!/bin/bash
# Destroy the KxGenNotificationsStack
# Usage: ./destroy-stack.sh [--force]
#   --force: Skip confirmation prompts

if [ "$1" == "--force" ]; then
  npm run destroy -- KxGenNotificationsStack --force
else
  npm run destroy -- KxGenNotificationsStack
fi

