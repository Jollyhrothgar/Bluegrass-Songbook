#!/usr/bin/env python3
"""
Enrichment Preview Viewer

Web-based tool for reviewing enrichment changes before applying them.
Shows side-by-side comparison of original vs enriched ChordPro files.
"""

import json
import random
import sys
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

# Get paths
SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent.parent
VIEWER_DIR = SCRIPT_DIR

# Add scripts/lib to path for imports
sys.path.insert(0, str(REPO_ROOT / 'scripts' / 'lib'))

from enrich_songs import (
    parse_song,
    add_provenance_metadata,
    has_provenance_metadata,
    song_to_chordpro,
    load_protected_list,
)


def get_all_pro_files():
    """Get all .pro files from all sources."""
    sources_dir = REPO_ROOT / 'sources'
    pro_files = []

    for source_dir in sources_dir.iterdir():
        if source_dir.is_dir():
            parsed_dir = source_dir / 'parsed'
            if parsed_dir.exists():
                source_name = source_dir.name
                for pro_file in parsed_dir.glob('*.pro'):
                    pro_files.append({
                        'path': pro_file,
                        'source': source_name,
                        'name': pro_file.name,
                    })

    return pro_files


def compute_enrichment_diff(original: str, enriched: str) -> dict:
    """Compute statistics about what changed."""
    orig_lines = original.split('\n')
    enrich_lines = enriched.split('\n')

    # Count metadata lines added
    orig_meta = sum(1 for l in orig_lines if l.startswith('{meta: x_'))
    enrich_meta = sum(1 for l in enrich_lines if l.startswith('{meta: x_'))
    metadata_added = enrich_meta - orig_meta

    # Count chords
    import re
    orig_chords = len(re.findall(r'\[[^\]]+\]', original))
    enrich_chords = len(re.findall(r'\[[^\]]+\]', enriched))
    chords_added = enrich_chords - orig_chords

    # Find changed lines
    changed_lines = []
    for i, (orig, enrich) in enumerate(zip(orig_lines, enrich_lines)):
        if orig != enrich:
            changed_lines.append({
                'line': i + 1,
                'before': orig,
                'after': enrich,
            })

    # New lines at the end
    if len(enrich_lines) > len(orig_lines):
        for i in range(len(orig_lines), len(enrich_lines)):
            changed_lines.append({
                'line': i + 1,
                'before': '',
                'after': enrich_lines[i],
            })

    return {
        'metadata_added': metadata_added,
        'chords_added': chords_added,
        'lines_changed': len(changed_lines),
        'changed_lines': changed_lines[:20],  # Limit to first 20
        'is_identical': original == enriched,
    }


def enrich_content(content: str, source_name: str, filename: str) -> str:
    """Apply enrichment to content and return result.

    Currently only adds provenance metadata. Chord normalization was removed
    because it incorrectly modified pickup phrases and songs with multiple
    verse patterns.
    """
    # Only add provenance if not present
    if not has_provenance_metadata(content):
        song = parse_song(content)
        song = add_provenance_metadata(song, source_name, filename)
        return song_to_chordpro(song)

    return content


class EnrichmentViewerServer(SimpleHTTPRequestHandler):
    """HTTP server for enrichment viewer UI"""

    # Class-level cache
    pro_files = None
    protected = None
    current_index = 0

    @classmethod
    def init_data(cls):
        """Initialize file list and protected list."""
        if cls.pro_files is None:
            cls.pro_files = get_all_pro_files()
            random.shuffle(cls.pro_files)

            # Load all protected files
            cls.protected = set()
            sources_dir = REPO_ROOT / 'sources'
            for source_dir in sources_dir.iterdir():
                if source_dir.is_dir():
                    protected_file = source_dir / 'protected.txt'
                    if protected_file.exists():
                        cls.protected.update(load_protected_list(protected_file))

    def do_GET(self):
        self.init_data()

        parsed_path = urlparse(self.path)
        path = parsed_path.path

        if path == '/' or path == '/index.html':
            self.serve_file(VIEWER_DIR / 'index.html', 'text/html')

        elif path == '/api/stats':
            self.serve_stats()

        elif path == '/api/random':
            self.serve_random_song()

        elif path == '/api/next':
            self.current_index = (self.current_index + 1) % len(self.pro_files)
            self.serve_song_at_index(self.current_index)

        elif path == '/api/prev':
            self.current_index = (self.current_index - 1) % len(self.pro_files)
            self.serve_song_at_index(self.current_index)

        elif path.startswith('/api/song/'):
            # Get specific song by index
            try:
                index = int(path.replace('/api/song/', ''))
                self.serve_song_at_index(index)
            except ValueError:
                self.send_error(400, 'Invalid index')

        else:
            self.send_error(404)

    def do_POST(self):
        parsed_path = urlparse(self.path)
        path = parsed_path.path

        if path == '/api/feedback':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            feedback = json.loads(post_data.decode('utf-8'))

            # Save to feedback file
            feedback_file = VIEWER_DIR / 'feedback.jsonl'
            with open(feedback_file, 'a') as f:
                f.write(json.dumps(feedback) + '\n')

            self.send_json({'success': True})
        else:
            self.send_error(404)

    def serve_file(self, filepath, content_type):
        """Serve a static file."""
        try:
            with open(filepath, 'rb') as f:
                content = f.read()

            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(content)
        except FileNotFoundError:
            self.send_error(404)

    def serve_stats(self):
        """Serve overall statistics."""
        total = len(self.pro_files)
        protected_count = sum(1 for f in self.pro_files if f['path'].stem in self.protected)

        self.send_json({
            'total_files': total,
            'protected_files': protected_count,
            'files_to_enrich': total - protected_count,
        })

    def serve_random_song(self):
        """Serve a random song for preview."""
        self.current_index = random.randint(0, len(self.pro_files) - 1)
        self.serve_song_at_index(self.current_index)

    def serve_song_at_index(self, index):
        """Serve song at specific index."""
        if not self.pro_files:
            self.send_json({'error': 'No files found'})
            return

        file_info = self.pro_files[index % len(self.pro_files)]
        pro_file = file_info['path']
        source_name = file_info['source']

        try:
            original = pro_file.read_text(encoding='utf-8')
            enriched = enrich_content(original, source_name, pro_file.name)
            diff = compute_enrichment_diff(original, enriched)

            is_protected = pro_file.stem in self.protected

            self.send_json({
                'index': index,
                'total': len(self.pro_files),
                'filename': pro_file.name,
                'source': source_name,
                'is_protected': is_protected,
                'original': original,
                'enriched': enriched,
                'diff': diff,
            })

        except Exception as e:
            self.send_json({
                'error': str(e),
                'filename': pro_file.name,
            })

    def send_json(self, data):
        """Send JSON response."""
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format, *args):
        """Suppress default logging."""
        pass


def run_server(port=8001):
    """Run the enrichment viewer server."""
    server_address = ('', port)
    httpd = HTTPServer(server_address, EnrichmentViewerServer)

    print(f"""
╔═══════════════════════════════════════════════════════════╗
║     Enrichment Preview Viewer                             ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  Viewer:  http://localhost:{port}/                        ║
║                                                           ║
║  Review enrichment changes before applying them.          ║
║  Shows side-by-side comparison of original vs enriched.   ║
║                                                           ║
║  Keyboard shortcuts:                                      ║
║    →  : Next song                                         ║
║    ←  : Previous song                                     ║
║    r  : Random song                                       ║
║    g  : Mark as good                                      ║
║    p  : Mark as problem                                   ║
║                                                           ║
║  Press Ctrl+C to stop                                     ║
╚═══════════════════════════════════════════════════════════╝
    """)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n\nServer stopped.")
        httpd.server_close()


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Enrichment Preview Viewer')
    parser.add_argument('--port', type=int, default=8001, help='Port (default: 8001)')
    args = parser.parse_args()
    run_server(args.port)
