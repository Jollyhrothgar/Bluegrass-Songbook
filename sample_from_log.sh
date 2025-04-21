#!/usr/bin/env bash

# Usage: ./sample_from_log.sh "A:1 T:1 C:1 L:1"

LOG_FILE="song_parsing_summary_scoring.log"
CONDITION="$1"
PROJECT_ROOT="$(pwd)"

if [ -z "$CONDITION" ]; then
  echo "Usage: $0 \"A:1 T:1 C:1 L:1\""
  exit 1
fi

# Choose shuffle command
if command -v shuf >/dev/null 2>&1; then
  SHUFFLER=shuf
elif command -v gshuf >/dev/null 2>&1; then
  SHUFFLER=gshuf
else
  echo "Error: 'shuf' or 'gshuf' is required. Try 'brew install coreutils'."
  exit 1
fi

# Search for matching file
MATCHING_LINE=$(tail -n +3 "$LOG_FILE" | grep "$CONDITION" | $SHUFFLER -n 1)

if [ -z "$MATCHING_LINE" ]; then
  echo "No match found for: $CONDITION"
  exit 1
fi

FILENAME=$(echo "$MATCHING_LINE" | cut -d '|' -f1 | xargs)
FULL_PATH=$(find "$PROJECT_ROOT/sources/www.classic-country-song-lyrics.com" -name "$FILENAME" | head -n 1)
FILE_URI="file://$FULL_PATH"

# Output result
echo "🎵 Sample Match:"
echo "$MATCHING_LINE"
echo
echo "📂 Full path:"
echo "$FULL_PATH"
echo
echo "🌐 Open in Chrome:"
echo "$FILE_URI"
