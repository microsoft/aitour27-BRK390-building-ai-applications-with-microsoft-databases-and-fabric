"""Business tools backed by HorizonDB; no model-generated SQL is executed."""

import hashlib
import os
import re
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import psycopg
from psycopg.rows import dict_row

PIPELINES = ("caldova_evidence_v3", "caldova_recommendation_usd_v1")
LOCK_ID = 290390


def connect():
    return psycopg.connect(os.environ.get("DATABASE_URL", ""), row_factory=dict_row,
                           connect_timeout=10, application_name="caldova-agent")


def clean(value) -> Any:
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(v) for v in value]
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, uuid.UUID)):
        return str(value)
    return value


def verify_brief(c, evaluation_id):
    choice = c.execute("""SELECT o.result FROM caldova.evaluated_options o JOIN caldova.evaluations e
        ON e.id=o.evaluation_id AND e.selected_scenario=o.scenario WHERE e.id=%s""", (evaluation_id,)).fetchone()
    rows = c.execute("""SELECT b.* FROM caldova.usd_briefs b JOIN caldova.usd_context x
        ON x.id=%s AND x.content=b.chunk_text WHERE b.metadata->>'evaluation_id'=%s""",
                     (evaluation_id, str(evaluation_id))).fetchall()
    if not choice or len(rows) != 1:
        raise ValueError('Expected one linked brief for the evaluated proposal')
    brief = rows[0]
    for field in ('extra_budget_usd', 'incremental_units', 'proposed_units', 'uplift_percent', 'production_gap_units'):
        if brief['metadata'].get(field) is None or Decimal(str(brief['metadata'][field])) != Decimal(str(choice['result'][field])):
            raise ValueError(f'Generated brief disagrees with SQL: {field}')
    if 'marketing approval pending' not in (brief['generated_text'] or '').lower():
        raise ValueError('Generated brief is missing pending approval status')
    current = c.execute("SELECT result->'eligible' AS eligible FROM caldova.evaluated_options WHERE evaluation_id=%s AND scenario='current'",
                        (evaluation_id,)).fetchone()
    if brief['metadata'].get('current_option_eligible') is not current['eligible']:
        raise ValueError('Generated brief misstates current option eligibility')


def owned(c, job_id, principal):
    row = c.execute("SELECT * FROM caldova.agent_jobs WHERE id=%s AND principal=%s",
                    (uuid.UUID(job_id), principal)).fetchone()
    if not row:
        raise ValueError("Campaign request not found for this user")
    return row


def evaluate_campaign(principal, question, budget_usd, request_key):
    if not 0 < len(question) <= 2000:
        raise ValueError("Question must contain 1–2000 characters")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", request_key):
        raise ValueError("Use a short alphanumeric request key")
    amount = Decimal(str(budget_usd))
    if not amount.is_finite() or not 0 <= amount <= 1000000:
        raise ValueError("USD budget must be between 0 and 1,000,000")
    job_id = uuid.uuid4()
    case_id = f"HYDRATION-SUNSCREEN-CAMPAIGN-{job_id.hex[:10].upper()}"
    with connect() as c:
        c.execute("""INSERT INTO caldova.agent_jobs
          (id,principal,request_key,question,budget_usd,case_id)
          VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(principal,request_key) DO NOTHING""",
                  (job_id, principal, request_key, question, amount, case_id))
        job = c.execute("SELECT * FROM caldova.agent_jobs WHERE principal=%s AND request_key=%s",
                        (principal, request_key)).fetchone()
        if job["question"] != question or job["budget_usd"] != amount:
            raise ValueError("Request key already belongs to different inputs; use a new key")
        return clean({"job_id": job["id"], "case_id": job["case_id"], "state": job["state"],
                      "currency": "USD", "planning_weeks": 6, "poll_after_seconds": 3})


def get_campaign_proposal(principal, job_id):
    with connect() as c:
        job = owned(c, job_id, principal)
        result = {k: job[k] for k in ("id", "case_id", "state", "error", "evaluation_id")}
        result["poll_after_seconds"] = 3
        result["details_url"] = os.environ.get("PUBLIC_BASE_URL", "http://localhost:8000").rstrip('/') + f"/?job={job_id}"
        if job["evaluation_id"]:
            ev = c.execute("SELECT * FROM caldova.evaluations WHERE id=%s", (job["evaluation_id"],)).fetchone()
            options = c.execute("SELECT scenario,result FROM caldova.evaluated_options WHERE evaluation_id=%s ORDER BY scenario",
                                (ev["id"],)).fetchall()
            result.update(selected_scenario=ev["selected_scenario"], options=options,
                          evidence=ev["input_snapshot"], input_hash=ev["input_hash"])
            briefs = c.execute("""SELECT b.generated_text,b.metadata FROM caldova.usd_briefs b
                JOIN caldova.usd_context x ON x.id=%s AND x.content=b.chunk_text
                WHERE b.metadata->>'evaluation_id'=%s""", (ev["id"], str(ev["id"]))).fetchall()
            result["brief"] = briefs[0] if len(briefs) == 1 else None
            if job["state"] == 'ready' and len(briefs) == 1:
                brief_hash = hashlib.sha256(briefs[0]["generated_text"].encode()).hexdigest()
                previous = c.execute("""SELECT token FROM caldova.agent_reviews WHERE job_id=%s
                    AND principal=%s AND evaluation_id=%s AND brief_hash=%s
                    AND expires_at>clock_timestamp()+interval '5 minutes' AND approved_plan_id IS NULL
                    ORDER BY expires_at DESC LIMIT 1""", (job['id'], principal, ev['id'], brief_hash)).fetchone()
                token = previous['token'] if previous else uuid.uuid4()
                if not previous:
                    c.execute("""INSERT INTO caldova.agent_reviews
                        (token,job_id,principal,evaluation_id,input_hash,brief_hash) VALUES(%s,%s,%s,%s,%s,%s)""",
                              (token, job["id"], principal, ev["id"], ev["input_hash"], brief_hash))
                result["review_token"] = str(token)
                result["approval_instruction"] = "Present this exact evaluation and production gap. Ask for explicit approval before calling approve_campaign_plan."
        return clean(result)


def approve_campaign_plan(principal, job_id, evaluation_id, review_token, user_confirmed):
    if user_confirmed is not True:
        raise ValueError("Explicit user approval is required")
    with connect() as c:
        job = owned(c, job_id, principal)
        review = c.execute("""SELECT * FROM caldova.agent_reviews WHERE token=%s AND job_id=%s
            AND principal=%s AND evaluation_id=%s FOR UPDATE""",
                           (uuid.UUID(review_token), job["id"], principal, evaluation_id)).fetchone()
        if not review:
            raise ValueError("Retrieve and present this proposal before approving it")
        if review["approved_plan_id"]:
            return {"approved_plan_id": review["approved_plan_id"], "state": "approved"}
        if review["expires_at"] <= datetime.now(timezone.utc):
            raise ValueError("Review expired; retrieve and review the proposal again")
        if job["evaluation_id"] != evaluation_id or job["state"] != 'ready':
            raise ValueError("This evaluation is not the ready proposal")
        rows = c.execute("""SELECT b.generated_text FROM caldova.usd_briefs b
            JOIN caldova.usd_context x ON x.id=%s AND x.content=b.chunk_text
            WHERE b.metadata->>'evaluation_id'=%s""", (evaluation_id, str(evaluation_id))).fetchall()
        if len(rows) != 1 or hashlib.sha256(rows[0]["generated_text"].encode()).hexdigest() != review["brief_hash"]:
            raise ValueError("Brief changed after review; retrieve it again")
        plan = c.execute("SELECT caldova.approve_evaluation(%s) AS id", (evaluation_id,)).fetchone()["id"]
        c.execute("UPDATE caldova.agent_reviews SET approved_plan_id=%s,approved_at=clock_timestamp() WHERE token=%s",
                  (plan, review["token"]))
        c.execute("UPDATE caldova.agent_jobs SET state='approved',updated_at=clock_timestamp() WHERE id=%s", (job["id"],))
        return {"approved_plan_id": plan, "state": "approved", "approved_actor": principal,
                "next_action": "Call get_production_request to obtain Karin's capacity-review message"}


def get_production_request(principal, job_id):
    with connect() as c:
        job = owned(c, job_id, principal)
        row = c.execute("""SELECT q.*,p.approved_at,p.approved_by FROM caldova.production_requests q
            JOIN caldova.approved_plans p ON p.id=q.approved_plan_id WHERE p.evaluation_id=%s""",
                        (job["evaluation_id"],)).fetchone()
        return clean(row) if row else {"status": "not_created", "explanation": "Approval is pending, or confirmed supply covers the plan"}


def get_ai_workflow(principal, job_id):
    with connect() as c:
        job = owned(c, job_id, principal)
        results = []
        for name in PIPELINES:
            definition = c.execute("""SELECT name,source_config,steps,sink_config,trigger_type,
                ai.explain(name) AS graph FROM ai.pipelines WHERE name=%s""", (name,)).fetchone()
            run = c.execute("""SELECT i.id,i.status,i.created_at,i.completed_at FROM caldova.agent_run_links l
                JOIN df.instances i ON i.id=l.run_id WHERE l.job_id=%s AND l.pipeline_name=%s""",
                            (job["id"], name)).fetchone()
            nodes = []
            if run:
                nodes = c.execute("""SELECT node_type,status,query FROM df.nodes WHERE instance_id=%s
                    AND node_type='SQL' ORDER BY created_at,id""", (run["id"],)).fetchall()
            results.append({"definition": definition, "run": run, "execution_steps": nodes})
        return clean({"pipelines": results})


def wait_pipeline(c, job, name):
    # One service worker holds a cluster-wide advisory lock. Table-source pipelines
    # remain shared: don't run manual demonstrations concurrently with this worker.
    existing = c.execute("SELECT run_id FROM caldova.agent_run_links WHERE job_id=%s AND pipeline_name=%s",
                         (job["id"], name)).fetchone()
    if existing:
        run_id = existing["run_id"]
    else:
        status = c.execute("SELECT last_run_status FROM ai.status(%s)", (name,)).fetchone()
        if status and status["last_run_status"] == 'running':
            raise ValueError("Pipeline is already running outside this job; wait before retrying")
        with c.transaction():
            response = c.execute("SELECT ai.run(%s) AS message", (name,)).fetchone()["message"]
            match = re.search(r"instance: ([^)]+)", response)
            if not match:
                raise RuntimeError("Pipeline did not return a durable instance identifier")
            run_id = match.group(1)
            c.execute("INSERT INTO caldova.agent_run_links VALUES(%s,%s,%s)", (job["id"], name, run_id))
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        state = c.execute("SELECT status FROM df.instances WHERE id=%s", (run_id,)).fetchone()
        if state and state["status"] == 'completed':
            return
        if state and state["status"] == 'failed':
            raise RuntimeError(f"{name} failed; inspect durable run {run_id}")
        time.sleep(2)
    raise TimeoutError(f"{name} has not finished; inspect run {run_id}")


def work_once():
    with connect() as c:
        c.autocommit = True
        if not c.execute("SELECT pg_try_advisory_lock(%s) AS acquired", (LOCK_ID,)).fetchone()["acquired"]:
            return False
        job = c.execute("""SELECT * FROM caldova.agent_jobs WHERE state IN
            ('queued','extracting','evaluating','generating') ORDER BY created_at LIMIT 1""").fetchone()
        if not job:
            return False
        try:
            if not job["request_id"]:
                with c.transaction():
                    request = c.execute("""INSERT INTO caldova.planning_requests(case_id,question,weeks,budget_limit)
                        VALUES(%s,%s,6,%s) RETURNING id""", (job["case_id"], job["question"], job["budget_usd"])).fetchone()
                    job["request_id"] = request["id"]
                    c.execute("UPDATE caldova.agent_jobs SET request_id=%s,state='extracting' WHERE id=%s",
                              (request["id"], job["id"]))
            c.execute("SELECT caldova.refresh_evidence_packets()")
            wait_pipeline(c, job, PIPELINES[0])
            if not job["evaluation_id"]:
                with c.transaction():
                    ev = c.execute("SELECT caldova.evaluate_request(%s) AS id", (job["request_id"],)).fetchone()
                    job["evaluation_id"] = ev["id"]
                    c.execute("UPDATE caldova.agent_jobs SET evaluation_id=%s,state='generating' WHERE id=%s",
                              (ev["id"], job["id"]))
            wait_pipeline(c, job, PIPELINES[1])
            verify_brief(c, job['evaluation_id'])
            c.execute("UPDATE caldova.agent_jobs SET state='ready',updated_at=clock_timestamp() WHERE id=%s", (job["id"],))
        except Exception as exc:
            c.execute("UPDATE caldova.agent_jobs SET state='failed',error=%s,updated_at=clock_timestamp() WHERE id=%s",
                      (str(exc).splitlines()[0][:500], job["id"]))
        return True
