@echo off
REM Destroy the KxGenNotificationsStack
REM Usage: destroy-stack.bat [--force]
REM   --force: Skip confirmation prompts

if "%1"=="--force" (
  npm run destroy -- KxGenNotificationsStack --force
) else (
  npm run destroy -- KxGenNotificationsStack
)









