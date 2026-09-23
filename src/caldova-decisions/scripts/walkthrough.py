#!/usr/bin/env python3
"""Run the database narrative, pausing at every presentation point."""

import argparse
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case-id', default='HYDRATION-SUNSCREEN-CAMPAIGN-001')
    parser.add_argument('--budget', type=int, default=30000)
    parser.add_argument('--auto', action='store_true', help='Run without presentation pauses')
    parser.add_argument('--approve', action='store_true', help='Record approval of the generated evaluation')
    parser.add_argument('--ai-showcase-only', action='store_true',
                        help='Show deployed definitions, graphs and real AI calls without creating a request')
    args = parser.parse_args()
    if args.budget < 0:
        parser.error('Budget must be nonnegative')
    for key in ('PGHOST', 'PGDATABASE', 'PGUSER'):
        if not os.environ.get(key):
            parser.error(f'Set {key} first')
    env = dict(os.environ, PGSSLMODE=os.environ.get('PGSSLMODE', 'require'), PAGER='cat')
    base = ['psql', '-X', '-w', '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off']

    def query(sql, capture=False, variables=None):
        command = base + (['-At'] if capture else [])
        for key, value in (variables or {}).items():
            command += ['-v', f'{key}={value}']
        result = subprocess.run(command, input=sql, text=True, env=env,
                                capture_output=capture, check=True)
        return result.stdout.strip() if capture else ''

    def stage(number, title):
        print(f'\n{number}. {title}', flush=True)
        if not args.auto:
            input('Press Enter to show this step... ')

    def spotlight(title):
        print(f'\n--- {title} ---', flush=True)
        if not args.auto:
            input('Press Enter when ready to show this screen... ')

    def show_definition(name, filename):
        spotlight(f'PIPELINE DEFINITION — {name}')
        print(f'VS Code: open sql/{filename}', flush=True)
        print((ROOT / 'sql' / filename).read_text(), flush=True)
        spotlight('DEPLOYED AI STEPS — read directly from HorizonDB')
        query(f"""SELECT step_number,step->>'step' AS ai_step,
step->>'model' AS model,step->>'column' AS input_column
FROM ai.pipelines CROSS JOIN LATERAL unnest(steps)
WITH ORDINALITY AS s(step,step_number) WHERE name='{name}';""")
        spotlight('PIPELINE GRAPH — source, AI steps, and saved output')
        query(f"SELECT ai.explain('{name}');")
        print('VS Code: postgres > Pipelines & Workflows > AI Pipelines; select this pipeline.', flush=True)

    def show_execution(name):
        spotlight('REAL EXECUTION — AI Functions inside the durable steps')
        query(f"""WITH latest AS (
 SELECT id,label,status FROM df.instances WHERE label='ai-pipeline:{name}'
 ORDER BY created_at DESC LIMIT 1
)
SELECT i.id AS run_id,i.status AS run_status,n.status AS step_status,
       CASE WHEN n.query LIKE '%azure_ai.generate(%' THEN 'azure_ai.generate()'
            WHEN n.query LIKE '%azure_ai.extract(%' THEN 'azure_ai.extract()' END AS ai_function,
       CASE WHEN n.query LIKE '%azure_ai.generate(%' THEN 'Write decision brief'
            WHEN n.query LIKE '%azure_ai.extract(generated_text%' THEN 'Extract generated claims'
            ELSE 'Extract source facts' END AS purpose
FROM latest i JOIN df.nodes n ON n.instance_id=i.id
WHERE n.node_type='SQL' AND
 (n.query LIKE '%azure_ai.generate(%' OR n.query LIKE '%azure_ai.extract(%')
ORDER BY CASE WHEN n.query LIKE '%azure_ai.extract(generated_text%' THEN 3
              WHEN n.query LIKE '%azure_ai.generate(%' THEN 2 ELSE 1 END;""")

    def immediate_function():
        spotlight('AI FUNCTION — extract facts from a regional outlook, live')
        sql = """SELECT azure_ai.extract(
    document => content,
    data => ARRAY['outlook_weeks: integer', 'assumptions: string'],
    model => 'caldova-chat'
) AS extracted_facts
FROM caldova.decision_documents
WHERE source_reference='OUTLOOK-North America';"""
        print(sql, flush=True)
        spotlight('EXECUTE THE FUNCTION — this calls the model now')
        query(sql)
        print('azure_ai.extract() executes now; ai.extract() describes a pipeline step.', flush=True)

    def pipeline(name):
        status = query(f"SELECT last_run_status FROM ai.status('{name}');", True)
        if status == 'running':
            raise RuntimeError(f'{name} is already running; wait before starting this walkthrough')
        query(f"SELECT ai.run('{name}');")
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            status = query(f"SELECT last_run_status FROM ai.status('{name}');", True)
            if status == 'completed':
                query(f"SELECT * FROM ai.status('{name}');")
                return
            if status == 'failed':
                query(f"""SELECT n.result AS failure FROM df.nodes n JOIN df.instances i ON i.id=n.instance_id
WHERE i.label='ai-pipeline:{name}' AND n.node_type='SQL' AND n.status='failed'
ORDER BY i.created_at DESC LIMIT 1;""")
                raise RuntimeError(f'{name} failed; inspect ai.status and df.instances')
            time.sleep(2)
        raise TimeoutError(f'{name} did not complete in 240 seconds')

    if args.ai_showcase_only:
        immediate_function()
        show_definition('caldova_evidence_v3', '51-evidence-pipeline.sql')
        show_execution('caldova_evidence_v3')
        show_definition('caldova_recommendation_usd_v1', '53-recommendation-pipeline.sql')
        show_execution('caldova_recommendation_usd_v1')
        print('Showing existing pipeline runs; only the standalone extraction called the model anew.')
        return

    stage(1, "Tim asks a question; no region allocation has been selected")
    request = query("""
INSERT INTO caldova.planning_requests(case_id,question,weeks,budget_limit)
VALUES(:'case_id','Compare current spend with an increase in USD. Which regions should we prioritise, and what must production confirm?',6,:'budget')
RETURNING id;
""", True, {'case_id': args.case_id, 'budget': args.budget})
    request_id = int(request.splitlines()[0])
    query(f'SELECT id,case_id,question,budget_limit,weeks FROM caldova.planning_requests WHERE id={request_id};')
    stage(2, 'Inspect authoritative data and the regional outlook documents')
    query('SELECT * FROM caldova.market_facts;')
    query('SELECT region,count(*) AS comparisons,round(avg(incremental_units/extra_spend),2) AS units_per_usd FROM caldova.campaign_history GROUP BY region ORDER BY region;')
    query("SELECT source_reference,content FROM caldova.decision_documents WHERE region IS NOT NULL OR source_reference IN (SELECT policy_id || '-v' || version FROM caldova.commercial_policies) ORDER BY id;")
    stage(3, 'AI Pipeline: extract usable evidence from business language')
    immediate_function()
    query('SELECT caldova.refresh_evidence_packets();')
    show_definition('caldova_evidence_v3', '51-evidence-pipeline.sql')
    spotlight('RUN THE EVIDENCE PIPELINE')
    pipeline('caldova_evidence_v3')
    show_execution('caldova_evidence_v3')
    spotlight('SAVED AI OUTPUT — evidence used by the decision')
    query("SELECT source_reference,metadata FROM caldova.current_evidence WHERE region IS NOT NULL OR source_reference IN (SELECT policy_id || '-v' || version FROM caldova.commercial_policies) ORDER BY id;")
    stage(4, 'SQL compares current, broad, and targeted investment')
    evaluation_id = int(query(f'SELECT caldova.evaluate_request({request_id});', True))
    query(f"""SELECT scenario,result->>'extra_budget_usd' AS extra_budget_usd,
result->>'incremental_units' AS extra_units,result->>'eligible' AS eligible,
result->>'channel_ok' AS channel_ok,result->>'production_gap_units' AS supply_gap
FROM caldova.evaluated_options WHERE evaluation_id={evaluation_id} ORDER BY scenario;""")
    query(f"""SELECT selected_scenario,input_hash FROM caldova.evaluations WHERE id={evaluation_id};
SELECT region->>'region' AS region,region->>'spend' AS extra_budget_usd,
region->>'incremental_units' AS extra_units,region->>'production_gap_units' AS supply_gap
FROM caldova.evaluated_options o CROSS JOIN LATERAL jsonb_array_elements(o.result->'regions') region
WHERE evaluation_id={evaluation_id} AND scenario=(SELECT selected_scenario FROM caldova.evaluations WHERE id={evaluation_id});""")
    stage(5, 'AI generates the recommendation; extraction checks its numerical claims')
    show_definition('caldova_recommendation_usd_v1', '53-recommendation-pipeline.sql')
    spotlight('RUN THE RECOMMENDATION PIPELINE')
    pipeline('caldova_recommendation_usd_v1')
    show_execution('caldova_recommendation_usd_v1')
    spotlight('SAVED AI OUTPUT — generated brief and extracted claims')
    query(f"SELECT metadata,generated_text FROM caldova.usd_briefs WHERE metadata->>'evaluation_id'='{evaluation_id}';")
    stage(6, 'Tim reviews the proposal and production dependency')
    print(f'Evaluation {evaluation_id}, request {request_id}.', flush=True)
    if not args.approve:
        print(f'Approval pending. To approve the reviewed version: SELECT caldova.approve_evaluation({evaluation_id});')
        return
    if not args.auto and input('Record approval of this exact evaluation? [yes/no] ') != 'yes':
        print('Approval remains pending.')
        return
    query(f'SELECT caldova.approve_evaluation({evaluation_id});')
    stage(7, 'The approved forecast is a saved commitment and a queued factory request')
    query(f"""SELECT id,evaluation_id,owner_name,approved_by,approved_at,marketing_status,production_status,
approved_forecast->>'incremental_units' AS committed_extra_units
FROM caldova.approved_plans WHERE evaluation_id={evaluation_id};
SELECT case_id,required_units,status FROM caldova.production_requests
WHERE approved_plan_id=(SELECT id FROM caldova.approved_plans WHERE evaluation_id={evaluation_id});""")


if __name__ == '__main__':
    main()
