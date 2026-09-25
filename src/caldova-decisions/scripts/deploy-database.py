#!/usr/bin/env python3
"""Deploy SQL through psql, preserving the existing pipeline and run history."""

import argparse
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--model-alias", default="caldova-chat")
parser.add_argument("--run", action="store_true", help="Run the walkthrough without approval after deployment")
parser.add_argument("--case-id", default="HYDRATION-SUNSCREEN-CAMPAIGN-001")
args = parser.parse_args()
for name in ("PGHOST", "PGUSER", "PGDATABASE"):
    if not os.environ.get(name):
        parser.error(f"Set {name} before deployment")
env = dict(os.environ, PGSSLMODE=os.environ.get("PGSSLMODE", "require"))
base = ["psql", "-X", "-w", "-v", "ON_ERROR_STOP=1", "-v", f"model_alias={args.model_alias}"]


def sql_file(name):
    subprocess.run([*base, "-f", str(ROOT / "sql" / name)], env=env, check=True)


def query(statement):
    return subprocess.check_output([*base, "-Atc", statement], env=env, text=True).strip()


sql_file("05-extensions.sql")
sql_file("50-decision-data.sql")
sql_file("57-usd-migration.sql")
sql_file("52-evaluate-and-approve.sql")
sql_file("55-presentation-views.sql")
sql_file("60-agent-service.sql")
# Factory memory capture is installed separately after sql/70-factory-planning.sql.
for pipeline, filename in (
    ("caldova_evidence_v3", "51-evidence-pipeline.sql"),
    ("caldova_recommendation_usd_v1", "53-recommendation-pipeline.sql"),
):
    exists = query(f"SELECT count(*) FROM ai.list_pipelines() WHERE name='{pipeline}'")
    if exists == "0":
        sql_file(filename)
    else:
        print(f"Existing {pipeline} preserved; inspect ai.explain before changing its definition.")
if args.run:
    import sys
    subprocess.run([sys.executable, str(ROOT / "scripts" / "walkthrough.py"),
                    "--auto", "--case-id", args.case_id], env=env, check=True)
