"""Internal, ephemeral TEF2 conversion service. Never publish its port."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import json
import subprocess
import tempfile

MAX_INPUT = 100_000
MAX_OUTPUT = 2_000_000


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(20)

    def log_message(self, *_):
        pass  # Do not retain filenames, private music, or parser diagnostics.

    def reply(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.reply(200 if self.path == '/health' else 404, {'status': 'ready'})

    def do_POST(self):
        if self.path != '/convert':
            return self.reply(404, {'error': 'Not found.'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            length = 0
        if not 258 <= length <= MAX_INPUT:
            return self.reply(413 if length > MAX_INPUT else 422, {'error': 'Choose a valid TEF2 file, up to 100 KB.'})
        data = self.rfile.read(length)
        if len(data) != length:
            return self.reply(422, {'error': 'Incomplete TEF upload.'})
        # TEF2 has a fixed header, unlike newer compressed TEF formats.
        measures = int.from_bytes(data[200:202], 'little')
        count = int.from_bytes(data[256:258], 'little')
        if not (1 <= measures <= 256 and data[202] == 4 and data[204] == 4 and data[240] == 5 and data[241] == 0 and 1 <= count <= 8192 and 258 + 6 * count <= length):
            return self.reply(422, {'error': 'This preview supports TEF2 files with one five-string track, 4/4, and up to 256 measures. This file is unsupported or invalid.'})
        with tempfile.TemporaryDirectory(prefix='tef-') as directory:
            source, output = Path(directory) / 'input.tef', Path(directory) / 'output.musicxml'
            source.write_bytes(data)
            try:
                subprocess.run(['java', '-Xmx256m', '-cp', '.:tux/lib/*:tux/share/plugins/*', 'TefProbe', str(source), str(output)],
                               check=True, timeout=15, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except subprocess.TimeoutExpired:
                return self.reply(422, {'error': 'TEF conversion exceeded the 15-second limit.'})
            except subprocess.CalledProcessError:
                return self.reply(422, {'error': 'This TEF could not be converted safely. It may be damaged or contain unsupported notation.'})
            if not output.is_file() or not 0 < output.stat().st_size <= MAX_OUTPUT:
                return self.reply(422, {'error': 'Converted score exceeds the preview size limit.'})
            musicxml = output.read_text()
        self.reply(200, {'musicxml': musicxml, 'warnings': [
            'Experimental TEF2 conversion: some techniques or source details may be unsupported. Compare with the original.',
            'This is a playable preview, not yet saved to your library. Download the converted MusicXML to keep it.'
        ]})


if __name__ == '__main__':
    HTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
