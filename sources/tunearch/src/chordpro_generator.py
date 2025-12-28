#!/usr/bin/env python3
"""
Generate ChordPro files from ABC tunes

Wraps ABC notation in {start_of_abc}/{end_of_abc} blocks with metadata.
"""

import re
from pathlib import Path
from typing import TYPE_CHECKING

try:
    from .abc_parser import extract_key_from_abc, extract_time_from_abc, extract_title_from_abc
except ImportError:
    from abc_parser import extract_key_from_abc, extract_time_from_abc, extract_title_from_abc

if TYPE_CHECKING:
    try:
        from .scraper import ABCTune
    except ImportError:
        from scraper import ABCTune


def abc_to_chordpro(tune: 'ABCTune') -> str:
    """Convert an ABCTune to ChordPro format with embedded ABC"""

    lines = []

    # Title from metadata or ABC
    title = tune.metadata.title
    abc_title = extract_title_from_abc(tune.abc_notation)
    if abc_title and not title:
        title = abc_title
    lines.append(f"{{meta: title {title}}}")

    # Artist/composer
    if tune.metadata.composer:
        lines.append(f"{{meta: composer {tune.metadata.composer}}}")
    lines.append("{meta: artist Traditional}")

    # Key from ABC or metadata
    key = extract_key_from_abc(tune.abc_notation) or tune.metadata.key
    if key:
        lines.append(f"{{key: {key}}}")

    # Time signature
    time_sig = extract_time_from_abc(tune.abc_notation) or tune.metadata.time_signature
    if time_sig:
        lines.append(f"{{time: {time_sig}}}")

    # Source metadata
    lines.append("{meta: x_source tunearch}")
    lines.append("{meta: x_type instrumental}")

    if tune.metadata.tunearch_url:
        lines.append(f"{{meta: x_tunearch_url {tune.metadata.tunearch_url}}}")

    if tune.metadata.meter_rhythm:
        lines.append(f"{{meta: x_rhythm {tune.metadata.meter_rhythm}}}")

    if tune.metadata.genre:
        lines.append(f"{{meta: x_genre {tune.metadata.genre}}}")

    if tune.metadata.mode:
        lines.append(f"{{meta: x_mode {tune.metadata.mode}}}")

    if tune.metadata.region:
        lines.append(f"{{meta: x_region {tune.metadata.region}}}")

    if tune.metadata.structure:
        lines.append(f"{{meta: x_structure {tune.metadata.structure}}}")

    if tune.metadata.theme_code:
        lines.append(f"{{meta: x_theme_code {tune.metadata.theme_code}}}")

    # Alt titles (limit to 3)
    for alt in tune.metadata.alt_titles[:3]:
        if alt and alt != title:
            lines.append(f"{{meta: x_alt_title {alt}}}")

    # Blank line before ABC
    lines.append("")

    # ABC notation block
    lines.append("{start_of_abc}")
    lines.append(tune.abc_notation)
    lines.append("{end_of_abc}")

    return '\n'.join(lines) + '\n'


def generate_filename(title: str) -> str:
    """Generate safe filename from tune title"""
    # Remove special characters, lowercase, limit length
    safe = re.sub(r'[^a-z0-9]', '', title.lower())
    if not safe:
        safe = 'untitled'
    return f"{safe[:50]}.pro"


def save_chordpro(chordpro: str, output_dir: Path, title: str) -> Path:
    """Save ChordPro content to file, handling duplicates"""
    output_dir.mkdir(parents=True, exist_ok=True)

    filename = generate_filename(title)
    output_path = output_dir / filename

    # Handle duplicates by adding counter
    counter = 1
    while output_path.exists():
        base = filename.rsplit('.', 1)[0]
        output_path = output_dir / f"{base}_{counter}.pro"
        counter += 1

    output_path.write_text(chordpro, encoding='utf-8')
    return output_path
