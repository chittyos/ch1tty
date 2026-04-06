#!/bin/bash
# ch1tty-ingest.sh — Ingest session logs through Ch1tty's local buffer
#
# Reads .jsonl session transcripts, writes to Ch1tty's buffer.
# Ch1tty's daemon handles flushing to ChittyConnect → Neon.
# Replaces all ingested logs with ONE synthetic session file for --resume.
#
# No HTTP calls. No auth. No timeouts. Local file operations only.
#
# Usage: bash ch1tty-ingest.sh [project-slug]

set -uo pipefail
# @canon: chittycanon://gov/governance#core-types

BUFFER_DIR="$HOME/.claude/chittycontext/buffers"
PROJECTS_DIR="$HOME/.claude/projects"
TARGET_SLUG="${1:-}"
ENTITY_ID="${CHITTY_ID:-03-1-USA-8244-P-2603-0-33}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}  Ch1tty Session Log Ingestion${NC}"
echo ""

mkdir -p "$BUFFER_DIR"

# Find project dirs
if [ -n "$TARGET_SLUG" ]; then
  PROJECT_DIRS=("$PROJECTS_DIR/$TARGET_SLUG")
else
  PROJECT_DIRS=()
  for d in "$PROJECTS_DIR"/*/; do
    [ -d "$d" ] && PROJECT_DIRS+=("$d")
  done
fi

total_ingested=0
total_bytes=0

for PROJECT_DIR in "${PROJECT_DIRS[@]}"; do
  [ -d "$PROJECT_DIR" ] || continue

  # Find session logs (skip synthetic stubs and active sessions)
  logs=()
  active_pids=()

  # Get active session pids for this project
  for sf in "$HOME/.claude/sessions"/*.json; do
    [ -f "$sf" ] || continue
    info=$(python3 -c "
import json
with open('$sf') as f:
    s = json.load(f)
print(f\"{s.get('pid','')}|{s.get('sessionId','')}\")
" 2>/dev/null) || continue
    IFS='|' read -r pid sid <<< "$info"
    kill -0 "$pid" 2>/dev/null && active_pids+=("$sid")
  done

  for f in "$PROJECT_DIR"/*.jsonl; do
    [ -f "$f" ] || continue
    session_id=$(basename "$f" .jsonl)
    # Skip synthetic stubs
    head -1 "$f" 2>/dev/null | grep -q "ch1tty_stub\|ch1tty_synthetic" && continue
    # Skip active sessions
    skip=false
    for active in "${active_pids[@]}"; do
      [ "$session_id" = "$active" ] && skip=true && break
    done
    [ "$skip" = true ] && continue
    logs+=("$f")
  done

  [ ${#logs[@]} -eq 0 ] && continue

  slug=$(basename "$PROJECT_DIR")
  project_name=$(echo "$slug" | sed 's/-/\//g' | rev | cut -d/ -f1-2 | rev)
  total_size=0
  for f in "${logs[@]}"; do
    size=$(wc -c < "$f" 2>/dev/null || echo 0)
    total_size=$((total_size + size))
  done
  total_mb=$((total_size / 1048576))

  echo -e "${BLUE}[ingest]${NC} $project_name: ${#logs[@]} logs (${total_mb}MB)"

  # Write each session to Ch1tty's buffer
  ingested=0
  archive_dir="$PROJECT_DIR/.ingested"
  mkdir -p "$archive_dir"
  topic_hints=""

  for f in "${logs[@]}"; do
    session_id=$(basename "$f" .jsonl)
    line_count=$(wc -l < "$f" 2>/dev/null || echo 0)
    file_hash=$(sha256sum "$f" 2>/dev/null | cut -d' ' -f1 || echo "unknown")

    # Extract first user message as topic hint (what --resume shows came from this session)
    hint=$(python3 -c "
import json
with open('$f') as fh:
    for line in fh:
        try:
            msg = json.loads(line.strip())
            if msg.get('type') == 'user' or (msg.get('message',{}).get('role') == 'user'):
                text = msg.get('message',{}).get('content','') if isinstance(msg.get('message'), dict) else str(msg.get('message',''))
                # First 60 chars, no newlines
                print(text.replace(chr(10),' ').strip()[:60])
                break
        except: pass
" 2>/dev/null)
    [ -n "$hint" ] && topic_hints="$topic_hints|$hint"

    # Write ingest event to Ch1tty buffer (local, instant)
    buffer_file="$BUFFER_DIR/ingest-$session_id.jsonl"

    python3 -c "
import json

events = []
with open('$f') as fh:
    for line in fh:
        try:
            events.append(json.loads(line.strip()))
        except:
            pass

# Write the full transcript as a buffer entry for Ch1tty
entry = {
    'type': 'SESSION_INGEST',
    'chitty_id': '$ENTITY_ID',
    'session_id': '$session_id',
    'project': '$project_name',
    'event_count': len(events),
    'file_hash': '$file_hash',
    'source': 'claude-code',
    'hostname': '$(hostname)',
    'events': events,
    'ts': __import__('datetime').datetime.now(__import__('datetime').UTC).isoformat()
}

with open('$buffer_file', 'w') as out:
    out.write(json.dumps(entry) + '\n')
" 2>/dev/null

    if [ -f "$buffer_file" ]; then
      # Buffer written — archive the original
      mv "$f" "$archive_dir/" 2>/dev/null
      [ -d "$PROJECT_DIR/$session_id" ] && mv "$PROJECT_DIR/$session_id" "$archive_dir/" 2>/dev/null
      ingested=$((ingested + 1))
      echo -e "${GREEN}  [ok]${NC} $session_id ($line_count events, hash: ${file_hash:0:12}) → buffer"
    else
      echo -e "${YELLOW}  [!!]${NC} $session_id — buffer write failed"
    fi
  done

  if [ "$ingested" -gt 0 ]; then
    # Write ONE synthetic session file for --resume
    # Claude Code's picker reads the first "type":"user" message to build the preview
    python3 -c "
import json, datetime, uuid

now = datetime.datetime.now(datetime.UTC).isoformat()
session_id = 'ch1tty-synthetic-' + uuid.uuid4().hex[:12]

# Build topic summary from collected hints
raw_hints = '$topic_hints'.strip('|').split('|')
hints = [h.strip() for h in raw_hints if h.strip()]
# Deduplicate and take up to 4 topics
seen = set()
topics = []
for h in hints:
    key = h.lower()[:30]
    if key not in seen:
        seen.add(key)
        topics.append(h)
    if len(topics) >= 4:
        break

if topics:
    topic_str = ' | '.join(topics)
    preview = f'Consolidated context for $project_name — $ingested sessions: {topic_str}'
else:
    preview = 'Consolidated context for $project_name — $ingested archived sessions'

# First line: user message (this is what --resume picker reads for preview)
user_msg = {
    'type': 'user',
    'message': {
        'role': 'user',
        'content': preview
    },
    'timestamp': now,
    'sessionId': session_id,
    'uuid': str(uuid.uuid4())
}

# Second line: assistant response with metadata (so the session has content)
assistant_msg = {
    'type': 'assistant',
    'message': {
        'role': 'assistant',
        'content': f'Ch1tty synthetic session. $ingested sessions consolidated. Topics: {topic_str if topics else \"(no topics extracted)\"}. Call /checkpoint resume to restore workstream context.'
    },
    'timestamp': now,
    'sessionId': session_id,
    'uuid': str(uuid.uuid4()),
    'metadata': {
        'ch1tty_synthetic': True,
        'ingested_sessions': $ingested,
        'ingested_at': now,
        'hostname': '$(hostname)',
        'project': '$project_name',
        'topics': topics,
        'resume': 'ch1tty/resume',
        'buffer_dir': '$BUFFER_DIR'
    }
}

with open('$PROJECT_DIR/session.jsonl', 'w') as f:
    f.write(json.dumps(user_msg) + '\n')
    f.write(json.dumps(assistant_msg) + '\n')
" 2>/dev/null

    echo -e "${GREEN}  [ok]${NC} $ingested archived, synthetic stub written"
    echo -e "${BLUE}[ingest]${NC} Ch1tty daemon will flush $ingested sessions to ledger"
    total_ingested=$((total_ingested + ingested))
    total_bytes=$((total_bytes + total_size))
  fi

  echo ""
done

total_mb=$((total_bytes / 1048576))
echo -e "${BOLD}  Done.${NC} $total_ingested sessions → Ch1tty buffer (${total_mb}MB reclaimed)"
echo "  Originals archived to .ingested/ (delete after daemon confirms ledger flush)"
echo "  Daemon flushes buffer → Ch1tty → ChittyConnect → Neon"

# Report buffer state
buffer_count=$(ls "$BUFFER_DIR"/ingest-*.jsonl 2>/dev/null | wc -l)
[ "$buffer_count" -gt 0 ] && echo "  Buffer: $buffer_count sessions pending flush"
