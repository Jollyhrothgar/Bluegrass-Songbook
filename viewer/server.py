#!/usr/bin/env python3
"""
Simple web server for the ChordPro validator UI
"""

import json
import sys
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import io

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.chordpro_parser import (
    StructureDetector, ContentExtractor, ChordProGenerator
)
from bs4 import BeautifulSoup


class ValidatorServer(SimpleHTTPRequestHandler):
    """HTTP server for validator UI"""

    def do_GET(self):
        parsed_path = urlparse(self.path)
        path = parsed_path.path

        # Serve static files
        if path == '/' or path == '/index.html':
            self.serve_file('viewer/index.html', 'text/html')

        # API: Get file list
        elif path == '/api/files':
            self.serve_file_list()

        # Serve HTML files
        elif path.startswith('/html/'):
            filename = path.replace('/html/', '')
            html_path = Path('html') / filename
            if html_path.exists():
                self.serve_file(str(html_path), 'text/html')
            else:
                self.send_error(404)

        # API: Get ChordPro for a file
        elif path.startswith('/api/chordpro/'):
            filename = path.replace('/api/chordpro/', '')
            self.serve_chordpro(filename)

        else:
            self.send_error(404)

    def do_POST(self):
        parsed_path = urlparse(self.path)
        path = parsed_path.path

        # API: Save feedback
        if path == '/api/feedback':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            feedback = json.loads(post_data.decode('utf-8'))

            # Save to feedback file
            feedback_file = Path('viewer/feedback.jsonl')
            with open(feedback_file, 'a') as f:
                f.write(json.dumps(feedback) + '\n')

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True}).encode())
        else:
            self.send_error(404)

    def serve_file(self, filepath, content_type):
        """Serve a file"""
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

    def serve_file_list(self):
        """Serve list of files from stratified sample"""
        try:
            # Try spot check sample first, then minimal, then full sample, fall back to pattern analysis
            if Path('stratified_sample_spot_check.json').exists():
                with open('stratified_sample_spot_check.json', 'r') as f:
                    sample = json.load(f)

                files = []
                for file_info in sample['files']:
                    files.append({
                        'name': file_info['name'],
                        'pattern': file_info.get('structure_type', 'unknown'),
                        'has_chords': True  # Assume stratified sample has chords
                    })
            elif Path('stratified_sample_minimal.json').exists():
                with open('stratified_sample_minimal.json', 'r') as f:
                    sample = json.load(f)

                files = []
                for file_info in sample['files']:
                    files.append({
                        'name': file_info['name'],
                        'pattern': file_info.get('structure_type', 'unknown'),
                        'has_chords': True  # Assume stratified sample has chords
                    })
            elif Path('stratified_sample.json').exists():
                with open('stratified_sample.json', 'r') as f:
                    sample = json.load(f)

                files = []
                for file_info in sample['files']:
                    files.append({
                        'name': file_info['name'],
                        'pattern': file_info.get('structure_type', 'unknown'),
                        'has_chords': True  # Assume stratified sample has chords
                    })
            else:
                # Fallback to pattern analysis
                with open('pattern_analysis.json', 'r') as f:
                    analysis = json.load(f)

                files = []
                for pattern_sig, pattern_data in analysis['patterns'].items():
                    for file_info in pattern_data['files'][:5]:  # Top 5 from each pattern
                        files.append({
                            'name': file_info['file'],
                            'pattern': pattern_sig,
                            'has_chords': file_info['has_chords']
                        })

            response = {'files': files}

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(response).encode())

        except Exception as e:
            self.send_error(500, str(e))

    def serve_chordpro(self, filename):
        """Parse HTML and return ChordPro"""
        try:
            html_path = Path('html') / filename

            if not html_path.exists():
                self.send_json_response({'success': False, 'error': 'File not found'})
                return

            with open(html_path, 'r', encoding='utf-8', errors='ignore') as f:
                html_content = f.read()

            # Parse
            soup = BeautifulSoup(html_content, 'html.parser')
            structure_type = StructureDetector.detect_structure_type(soup)

            if not structure_type:
                self.send_json_response({
                    'success': False,
                    'error': 'Could not determine structure type'
                })
                return

            song = ContentExtractor.parse(soup, structure_type, filename)
            chordpro = ChordProGenerator.song_to_chordpro(song)

            self.send_json_response({
                'success': True,
                'chordpro': chordpro,
                'structure_type': structure_type
            })

        except Exception as e:
            self.send_json_response({'success': False, 'error': str(e)})

    def send_json_response(self, data):
        """Send JSON response"""
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())


def run_server(port=8000):
    """Run the validator server"""
    server_address = ('', port)
    httpd = HTTPServer(server_address, ValidatorServer)

    print(f"""
╔═══════════════════════════════════════════════════════════╗
║     ChordPro Parser Validator                             ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  Server running at: http://localhost:{port}              ║
║                                                           ║
║  Open this URL in your browser to start validation       ║
║                                                           ║
║  Keyboard shortcuts:                                      ║
║    ← → : Navigate files                                   ║
║    1   : Mark as correct                                  ║
║    2   : Mark as minor issues                             ║
║    3   : Mark as wrong                                    ║
║                                                           ║
║  Feedback saved to: viewer/feedback.jsonl                 ║
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
    run_server()
