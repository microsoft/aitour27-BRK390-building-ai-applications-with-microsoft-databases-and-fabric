#!/usr/bin/env python3
"""Start the authenticated Teams bot with locally stored development credentials."""
import json
import os
from pathlib import Path
import sys

root=Path(__file__).resolve().parents[1]
config=json.loads((root/'.azure/local/factory-bot.json').read_text())
os.environ.update(config)
os.execv(sys.executable,[sys.executable,'-m','factory_agent.bot'])
