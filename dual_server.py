#!/usr/bin/env python3
"""
DUAL HTTP + HTTPS SERVER FOR APEX MAPS
Runs HTTP on port 8080 (for easy plain http:// access)
Runs HTTPS on port 8443 (for secure mobile sensor https:// access)
"""

import http.server
import ssl
import threading
import os

DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

def run_http_server():
    httpd = http.server.HTTPServer(('0.0.0.0', 8080), Handler)
    print("=== HTTP Server Running on port 8080 ===")
    print("Plain HTTP Link: http://localhost:8080")
    httpd.serve_forever()

def run_https_server():
    httpd = http.server.HTTPServer(('0.0.0.0', 8443), Handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=os.path.join(DIRECTORY, 'cert.pem'), keyfile=os.path.join(DIRECTORY, 'key.pem'))
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    print("=== HTTPS Server Running on port 8443 ===")
    print("Secure HTTPS Link: https://localhost:8443")
    print("Mobile HTTPS Link: https://10.210.100.167:8443")
    httpd.serve_forever()

if __name__ == '__main__':
    t1 = threading.Thread(target=run_http_server, daemon=True)
    t2 = threading.Thread(target=run_https_server, daemon=True)
    t1.start()
    t2.start()
    t1.join()
    t2.join()
