"""
Work schema definitions for the works/ artifact repository.

A "work" represents a musical composition with one or more parts:
- Lead sheet (ChordPro lyrics + chords)
- Tablature (HTF/OTF for specific instruments)
- Notation (ABC for melody)

Each part can have variants (different arrangements, user submissions).
"""

from dataclasses import dataclass, field
from datetime import date
from typing import Optional
import yaml


@dataclass
class Provenance:
    """Tracks where content came from for attribution and debugging."""
    source: str  # 'classic-country', 'manual', 'tef-import', 'user-submission'
    source_file: Optional[str] = None  # Original filename
    source_url: Optional[str] = None  # Original URL if scraped
    author: Optional[str] = None  # Who created/tabbed it
    submitted_by: Optional[str] = None  # Username for submissions
    submitted_at: Optional[str] = None  # Date submitted
    imported_at: Optional[str] = None  # Date migrated to works/
    github_issue: Optional[int] = None  # Tracking issue number


@dataclass
class Part:
    """A single part within a work (lead sheet, tablature, notation)."""
    type: str  # 'lead-sheet', 'tablature', 'melody'
    format: str  # 'chordpro', 'htf', 'abc'
    file: str  # Filename within work directory
    default: bool = False  # Is this the default part to show?
    instrument: Optional[str] = None  # For tablature: 'banjo', 'mandolin', etc.
    label: Optional[str] = None  # Human-readable label (e.g., "Scruggs Style")
    provenance: Optional[Provenance] = None


@dataclass
class ExternalLinks:
    """Links to external resources."""
    strum_machine: Optional[str] = None
    youtube: Optional[str] = None
    spotify: Optional[str] = None


@dataclass
class Work:
    """A musical work with metadata and parts."""
    id: str  # URL-safe identifier (e.g., 'cripple-creek')
    title: str
    artist: Optional[str] = None  # null for traditional
    composers: list[str] = field(default_factory=list)
    default_key: Optional[str] = None
    default_tempo: Optional[int] = None
    time_signature: Optional[str] = None
    tags: list[str] = field(default_factory=list)
    external: Optional[ExternalLinks] = None
    parts: list[Part] = field(default_factory=list)

    # Computed/derived fields (not stored in work.yaml, added at build time)
    group_id: Optional[str] = None

    def to_yaml(self) -> str:
        """Serialize to YAML for work.yaml file."""
        data = {
            'id': self.id,
            'title': self.title,
        }

        if self.artist:
            data['artist'] = self.artist
        if self.composers:
            data['composers'] = self.composers
        if self.default_key:
            data['default_key'] = self.default_key
        if self.default_tempo:
            data['default_tempo'] = self.default_tempo
        if self.time_signature:
            data['time_signature'] = self.time_signature
        if self.tags:
            data['tags'] = self.tags

        if self.external:
            ext = {}
            if self.external.strum_machine:
                ext['strum_machine'] = self.external.strum_machine
            if self.external.youtube:
                ext['youtube'] = self.external.youtube
            if self.external.spotify:
                ext['spotify'] = self.external.spotify
            if ext:
                data['external'] = ext

        if self.parts:
            data['parts'] = []
            for part in self.parts:
                p = {
                    'type': part.type,
                    'format': part.format,
                    'file': part.file,
                }
                if part.default:
                    p['default'] = True
                if part.instrument:
                    p['instrument'] = part.instrument
                if part.label:
                    p['label'] = part.label
                if part.provenance:
                    prov = {'source': part.provenance.source}
                    if part.provenance.source_file:
                        prov['source_file'] = part.provenance.source_file
                    if part.provenance.source_url:
                        prov['source_url'] = part.provenance.source_url
                    if part.provenance.author:
                        prov['author'] = part.provenance.author
                    if part.provenance.submitted_by:
                        prov['submitted_by'] = part.provenance.submitted_by
                    if part.provenance.submitted_at:
                        prov['submitted_at'] = part.provenance.submitted_at
                    if part.provenance.imported_at:
                        prov['imported_at'] = part.provenance.imported_at
                    if part.provenance.github_issue:
                        prov['github_issue'] = part.provenance.github_issue
                    p['provenance'] = prov
                data['parts'].append(p)

        return yaml.dump(data, default_flow_style=False, allow_unicode=True, sort_keys=False)

    @classmethod
    def from_yaml(cls, yaml_content: str) -> 'Work':
        """Parse from YAML content."""
        data = yaml.safe_load(yaml_content)

        external = None
        if 'external' in data:
            ext = data['external']
            external = ExternalLinks(
                strum_machine=ext.get('strum_machine'),
                youtube=ext.get('youtube'),
                spotify=ext.get('spotify'),
            )

        parts = []
        for p in data.get('parts', []):
            prov = None
            if 'provenance' in p:
                pv = p['provenance']
                prov = Provenance(
                    source=pv.get('source', 'unknown'),
                    source_file=pv.get('source_file'),
                    source_url=pv.get('source_url'),
                    author=pv.get('author'),
                    submitted_by=pv.get('submitted_by'),
                    submitted_at=pv.get('submitted_at'),
                    imported_at=pv.get('imported_at'),
                    github_issue=pv.get('github_issue'),
                )
            parts.append(Part(
                type=p['type'],
                format=p['format'],
                file=p['file'],
                default=p.get('default', False),
                instrument=p.get('instrument'),
                label=p.get('label'),
                provenance=prov,
            ))

        return cls(
            id=data['id'],
            title=data['title'],
            artist=data.get('artist'),
            composers=data.get('composers', []),
            default_key=data.get('default_key'),
            default_tempo=data.get('default_tempo'),
            time_signature=data.get('time_signature'),
            tags=data.get('tags', []),
            external=external,
            parts=parts,
        )


def slugify(text: str) -> str:
    """Convert text to URL-safe slug."""
    import re
    import unicodedata

    # Normalize unicode
    text = unicodedata.normalize('NFKD', text)
    text = text.encode('ascii', 'ignore').decode('ascii')

    # Lowercase and replace spaces/special chars
    text = text.lower()
    text = re.sub(r'[^a-z0-9]+', '-', text)
    text = text.strip('-')

    # Collapse multiple dashes
    text = re.sub(r'-+', '-', text)

    return text


# Example usage
if __name__ == '__main__':
    # Create example work
    work = Work(
        id='cripple-creek',
        title='Cripple Creek',
        composers=['Traditional'],
        default_key='G',
        default_tempo=160,
        time_signature='2/2',
        tags=['Bluegrass', 'Instrumental', 'JamFriendly'],
        external=ExternalLinks(
            strum_machine='https://strummachine.com/app/songs/xxx'
        ),
        parts=[
            Part(
                type='lead-sheet',
                format='chordpro',
                file='lead-sheet.pro',
                default=True,
                provenance=Provenance(
                    source='classic-country',
                    source_file='cripple-creek.pro',
                    imported_at=str(date.today()),
                ),
            ),
        ],
    )

    print("=== work.yaml ===")
    print(work.to_yaml())

    # Round-trip test
    parsed = Work.from_yaml(work.to_yaml())
    print("=== Round-trip OK ===")
    print(f"ID: {parsed.id}")
    print(f"Title: {parsed.title}")
    print(f"Parts: {len(parsed.parts)}")
