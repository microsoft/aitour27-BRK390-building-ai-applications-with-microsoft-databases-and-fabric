#!/usr/bin/env python3
"""Start the MCP/web server and persistent-job worker with one command."""

import argparse
import os
import signal
import subprocess
import sys
import time


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--host', default='127.0.0.1')
    p.add_argument('--port', type=int, default=8000)
    args = p.parse_args()
    if os.environ.get('AUTH_MODE', 'entra') == 'local' and args.host not in ('127.0.0.1', '::1'):
        p.error('Local mode must bind to a loopback address; use Entra mode for remote access')
    for key in ('PGHOST', 'PGDATABASE', 'PGUSER'):
        if not os.environ.get(key) and not os.environ.get('DATABASE_URL'):
            p.error(f'Set {key} or DATABASE_URL first')
    processes = []

    def stop(*_):
        for process in processes:
            if process.poll() is None:
                process.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        processes.append(subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app.server:app',
                                           '--host', args.host, '--port', str(args.port), '--no-proxy-headers']))
        processes.append(subprocess.Popen([sys.executable, '-m', 'app.worker']))
        while all(p.poll() is None for p in processes):
            time.sleep(1)
    finally:
        stop()
        for process in processes:
            try:
                process.wait(timeout=12)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == '__main__':
    main()
