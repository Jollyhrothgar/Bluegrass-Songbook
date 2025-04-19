#!/usr/bin/env bash

# --- Configuration ---
# Standard ignore pattern for clutter
IGNORE_PATTERN=".git|__pycache__|.venv|.vscode|*.pyc|*.log|*.json|dist|build|*.egg-info"
# How many items to show per directory under 'sources/'
SOURCES_FILE_LIMIT=3

# --- Script Logic ---

echo "--- Project Overview (Top Level + 'src' & 'tests' structure) ---"
# Show top-level files and directories (depth 1)
# Use ls for simplicity here, filtering directories
echo "."
ls -p | grep -v / | sed "s/^/├── /" # List files
ls -pd */ | grep -v 'sources/' | sed "s|^|├── |" # List dirs except sources

# Show specific important directories like src and tests normally
if [ -d "src" ]; then
    echo "│" # Connector depends on whether other dirs were listed, complex to get perfect
    echo "├── src/"
    # Show tree for src, indenting lines after the first
    tree -I "$IGNORE_PATTERN" src/ | sed '1d; s/^/│   /'
fi

if [ -d "tests" ]; then
    echo "│" # Connector
    echo "├── tests/"
    # Show tree for tests, indenting lines after the first
    tree -I "$IGNORE_PATTERN" tests/ | sed '1d; s/^/│   /'
fi


echo # Separator

# Show the 'sources' directory structure separately with the file limit
echo "--- Content Overview: 'sources' directory (showing max ${SOURCES_FILE_LIMIT} items per folder) ---"
if [ -d "sources" ]; then
    # Use --filelimit specifically for the sources directory tree
    tree -I "$IGNORE_PATTERN" --filelimit "$SOURCES_FILE_LIMIT" sources/
else
    echo "'sources' directory not found."
fi

echo # Separator
echo "--- End of Report ---"