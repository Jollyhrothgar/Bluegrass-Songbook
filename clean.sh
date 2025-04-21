#!/usr/bin/env bash

# Script to remove generated files and directories from the ChordPro converter project.
# Run this script from the project root directory.

echo "Cleaning project..."

# Remove specific log and output files
echo "Removing log files (*.log)..."
rm -f parsing_log.log
rm -f parsing_errors.log

echo "Removing JSON output (parsing_results.json)..."
rm -f parsing_results.json

# Remove output directories (use -rf to remove directories and their contents)
echo "Removing ChordPro output directory (output_pro/)..."
rm -rf output_pro/

echo "Removing test output directory (tests/test_outputs/)..."
rm -rf tests/test_outputs/

# Remove pytest cache
echo "Removing pytest cache (.pytest_cache/)..."
rm -rf .pytest_cache/

# Remove Python cache files and directories recursively
echo "Removing Python cache files (__pycache__/, *.pyc)..."
find . -type d -name "__pycache__" -exec rm -rf {} +
find . -type f -name "*.pyc" -delete

# Remove common build/distribution artifacts (optional, but good practice)
echo "Removing build artifacts (dist/, build/, *.egg-info/)..."
rm -rf dist/
rm -rf build/
rm -rf *.egg-info/

# Remove coverage data (optional)
echo "Removing coverage data (.coverage, htmlcov/)..."
rm -f .coverage*
rm -rf htmlcov/

# Remove logging data
echo "Removing logs"
rm -f ./song_parsing_debug.log

echo "Cleaning complete."
