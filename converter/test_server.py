import http.client
from http.server import HTTPServer
import json
from pathlib import Path
import subprocess
import threading
import unittest
from unittest.mock import patch
from server import Handler


class ConverterTest(unittest.TestCase):
    def setUp(self):
        self.server = HTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def post(self, body):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        connection.request('POST', '/convert', body=body)
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result

    def valid_header(self):
        data = bytearray(264)
        data[200] = data[256] = 1
        data[202] = data[204] = 4
        data[240] = 5
        return data

    def test_rejects_invalid_and_large_uploads_without_running_java(self):
        with patch('server.subprocess.run') as run:
            self.assertEqual(self.post(b'invalid')[0], 422)
            self.assertEqual(self.post(b'x' * 100001)[0], 413)
            self.assertEqual(self.post(bytes(264))[0], 422)
            run.assert_not_called()

    def test_success_cleans_up_files(self):
        paths = []
        def convert(command, **options):
            paths.extend([Path(command[-2]), Path(command[-1])])
            paths[-1].write_text('<score-partwise/>')
            self.assertEqual(options['timeout'], 15)
        with patch('server.subprocess.run', side_effect=convert):
            status, result = self.post(self.valid_header())
        self.assertEqual(status, 200)
        self.assertEqual(result['musicxml'], '<score-partwise/>')
        self.assertTrue(result['warnings'])
        self.assertTrue(all(not p.exists() for p in paths))

    def test_failed_and_timed_out_conversions_are_safe_errors(self):
        for error in (subprocess.TimeoutExpired('java', 15), subprocess.CalledProcessError(1, 'java')):
            with patch('server.subprocess.run', side_effect=error):
                status, result = self.post(self.valid_header())
                self.assertEqual(status, 422)
                self.assertIn('error', result)


if __name__ == '__main__':
    unittest.main()
