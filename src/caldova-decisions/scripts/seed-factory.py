#!/usr/bin/env python3
"""Attach a production case to an exact, approved marketing commitment."""
import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.service import connect

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--case-id', default='HYDRATION-SUNSCREEN-CAMPAIGN-001')
p.add_argument('--karin-id', required=True, help='Karin demo user Entra object ID')
args = p.parse_args()
with connect() as c:
    plan = c.execute('''SELECT p.id,p.approved_forecast,r.product FROM caldova.approved_plans p
        JOIN caldova.planning_requests r ON r.id=p.request_id WHERE r.case_id=%s''', (args.case_id,)).fetchone()
    if not plan:
        raise SystemExit('Approve the named marketing campaign before creating the production case')
    if plan['approved_forecast'].get('currency') != 'USD':
        raise SystemExit('Use an approved USD campaign')
    c.execute('''INSERT INTO factory.cases VALUES(%s,%s,%s,%s,'PKG-03',6,10,3,%s,%s)
        ON CONFLICT DO NOTHING''', (args.case_id, plan['id'], plan['product'],
        int(plan['approved_forecast']['incremental_units']),args.karin_id,
        'Six-week campaign launch buffer due by planning day 10; approved bulk product and packaging materials available from day 3. Alternate line qualified for this SKU. Fictional scheduling fixture.'))
    print('Production case linked to approved marketing plan', plan['id'], args.case_id)
