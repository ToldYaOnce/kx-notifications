#!/usr/bin/env bash
set -euo pipefail

# Stop Git Bash from mangling /aws/... into /Program Files/Git/...
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

LOGFILE="log.txt"
: > "$LOGFILE"   # truncate on each run

DURATION_MIN="${DURATION_MIN:-50}"   # override by env if needed, e.g. DURATION_MIN=360
LIMIT_PER_QUERY=1000                 # pull plenty; we'll trim later

# Order matters — we’ll read output in this exact order.
QUERY='fields @timestamp, @logStream, @log, @message
| sort @timestamp desc'

REGION="${AWS_REGION:-$(aws configure get region)}"
: "${REGION:?Set AWS_REGION or configure a default region (aws configure).}"

START=$(( $(date +%s) - DURATION_MIN*60 ))
END=$(date +%s)

# Collect all log group names
mapfile -t LOG_GROUPS < <(aws logs describe-log-groups \
  --region "$REGION" \
  --query 'logGroups[].logGroupName' \
  --output text | tr '\t' '\n' | sed '/^$/d')

if [[ ${#LOG_GROUPS[@]} -eq 0 ]]; then
  echo "No log groups found in $REGION." | tee -a "$LOGFILE"
  exit 0
fi

tmp_results="$(mktemp)"
trap 'rm -f "$tmp_results"' EXIT

run_batch () {
  local -a batch=("$@")
  local qid status

  qid=$(aws logs start-query \
    --region "$REGION" \
    --start-time "$START" \
    --end-time "$END" \
    --limit "$LIMIT_PER_QUERY" \
    --query-string "$QUERY" \
    --log-group-names "${batch[@]}" \
    --query 'queryId' --output text)

  # wait
  while : ; do
    status=$(aws logs get-query-results --region "$REGION" --query-id "$qid" --query 'status' --output text)
    [[ "$status" == "Complete" ]] && break
    [[ "$status" == "Failed" || "$status" == "Cancelled" || "$status" == "Timeout" ]] && { echo "Query $qid $status" >&2; return 1; }
    sleep 1
  done

  # Emit tab-separated rows in same order as 'fields' clause
  # Then immediately drop empties/short rows (require >= 4 fields)
  aws logs get-query-results --region "$REGION" --query-id "$qid" \
    --query "results[].[*].value" \
    --output text \
  | awk -F'\t' 'NF>=4 && $1!=""' >> "$tmp_results"
}

# Run in batches of 50 (API limit)
batch=()
for lg in "${LOG_GROUPS[@]}"; do
  batch+=("$lg")
  if [[ ${#batch[@]} -eq 50 ]]; then
    run_batch "${batch[@]}"; batch=()
  fi
done
[[ ${#batch[@]} -gt 0 ]] && run_batch "${batch[@]}"

# Write header
{
  printf "%-24s  %-60s  %-40s  %s\n" "timestamp" "logStream" "log" "message"
  printf -- "%0.s-" {1..160}; echo
} >> "$LOGFILE"

# If nothing usable came back, say so
if [[ ! -s "$tmp_results" ]]; then
  echo "No log events found with all four fields in the last ${DURATION_MIN} minutes across ${#LOG_GROUPS[@]} groups." >> "$LOGFILE"
  exit 0
fi

# Sort desc by timestamp (col 1), take top 50, and print
sort -r "$tmp_results" \
| head -n 50 \
| while IFS=$'\t' read -r ts stream log msg; do
    printf "%-24s  %-60s  %-40s  %s\n" "$ts" "$stream" "${log:0:40}" "$msg"
  done >> "$LOGFILE"

echo "Results written to $LOGFILE"
