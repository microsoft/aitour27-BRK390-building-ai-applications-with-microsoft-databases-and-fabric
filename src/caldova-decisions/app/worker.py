"""Persistent-job worker; safe to restart between pipeline steps."""

import logging
import time
from app.service import work_once

logging.basicConfig(level=logging.INFO)

if __name__ == '__main__':
    while True:
        try:
            if not work_once():
                time.sleep(2)
        except Exception:
            logging.exception('Worker unavailable; retrying database connection')
            time.sleep(5)
