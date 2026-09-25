#!/usr/bin/env python3
"""
LOCAL HTTPS SERVER FOR APEX MAPS & MOBILE SENSORS
Runs on port 8080 to ensure open firewall/network access across mobile devices.
"""

import http.server
import ssl
import os

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

httpd = http.server.HTTPServer(('0.0.0.0', PORT), Handler)

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(certfile=os.path.join(DIRECTORY, 'cert.pem'), keyfile=os.path.join(DIRECTORY, 'key.pem'))

httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

print(f"=== HTTPS Secure Server Running on Port {PORT} ===")
print(f"Desktop Access: https://localhost:{PORT}")
print(f"Mobile Access:  https://10.210.100.167:{PORT}")

httpd.serve_forever()
