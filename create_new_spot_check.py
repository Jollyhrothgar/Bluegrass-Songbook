#!/usr/bin/env python3
"""
Create a fresh stratified spot-check sample of 10 files for validation
"""

import json
import random
from pathlib import Path

# Load the batch processing results
with open('batch_processing_report.json', 'r') as f:
    results = json.load(f)

# Categorize successful files by structure type
by_structure = {}
for item in results['success']:
    stype = item['structure_type']
    if stype not in by_structure:
        by_structure[stype] = []
    by_structure[stype].append(item['file'])

# Calculate proportional sample sizes
total_success = len(results['success'])
sample_size = 10

# Set a different random seed to get different files
random.seed(42)

spot_check_files = []

# Sample proportionally from each structure type
for stype, files in sorted(by_structure.items()):
    count = len(files)
    proportion = count / total_success
    num_samples = max(1, round(proportion * sample_size))
    
    # Random sample from this structure type
    sampled = random.sample(files, min(num_samples, len(files)))
    
    for file in sampled:
        spot_check_files.append({
            'name': file,
            'structure_type': stype,
            'has_chords': True
        })
    
    print(f"{stype}: {count} files ({proportion*100:.1f}%) -> {num_samples} samples")

# Trim to exactly 10 if we over-sampled
if len(spot_check_files) > 10:
    spot_check_files = random.sample(spot_check_files, 10)

# Save spot check sample
output = {
    'description': 'Fresh stratified spot-check sample for validation (v2)',
    'total_files': len(spot_check_files),
    'files': spot_check_files
}

with open('stratified_sample_spot_check.json', 'w') as f:
    json.dump(output, f, indent=2)

print(f"\nTotal spot check files: {len(spot_check_files)}")
print("\nSpot check sample saved to: stratified_sample_spot_check.json")
print("\nFiles selected:")
for f in spot_check_files:
    print(f"  - {f['name']} ({f['structure_type']})")
