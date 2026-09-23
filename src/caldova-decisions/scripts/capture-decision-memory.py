#!/usr/bin/env python3
"""Backfill/process approved production decisions into Cosmos DB with Agent Memory Toolkit."""
import argparse
import json
import sys
import time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from decision_memory.capture import capture
from app.service import connect

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--proposal-id',type=int,help='Exact approved production proposal ID')
p.add_argument('--watch',action='store_true',help='Poll transactional capture events and retry failures')
p.add_argument('--review',action='store_true',help='Recheck completed capture and correct known summary transpositions')
args=p.parse_args()
if not args.watch and args.proposal_id is None:
    p.error('--proposal-id is required unless --watch is used')
if not args.watch:
    print(json.dumps(capture(args.proposal_id,review=args.review),indent=2))
else:
    while True:
        with connect() as c:
            jobs=c.execute("SELECT proposal_id FROM factory.memory_outbox WHERE status<>'completed' AND attempts<5 ORDER BY captured_at").fetchall()
        for job in jobs:
            try:print(json.dumps(capture(job['proposal_id'])),flush=True)
            except Exception as exc:print(f"Memory capture failed for {job['proposal_id']}: {type(exc).__name__}",flush=True)
        time.sleep(30)
