"""Read planning evidence, propose schedules, and approve as Karin's Teams identity."""

import re
from psycopg.types.json import Jsonb

from app.service import connect, clean
from factory_agent.planner import assess, propose, fingerprint


def snapshot(c, case_id):
    case = c.execute('SELECT * FROM factory.cases WHERE case_id=%s', (case_id,)).fetchone()
    if not case:
        raise ValueError('Unknown production case. Supply the case ID from the approved marketing plan.')
    return clean({'case': case,
                  'capacity': c.execute('SELECT * FROM factory.daily_capacity ORDER BY line,day').fetchall(),
                  'maintenance': c.execute('SELECT * FROM factory.maintenance ORDER BY id').fetchall(),
                  'reservations': c.execute('SELECT * FROM factory.allocations ORDER BY proposal_id,line,day').fetchall()})


def format_assessment(case_id, data):
    windows = ', '.join(f"{m['id']} on days {m['start_day']}–{m['end_day']}" for m in data['maintenance'])
    if not data['at_risk_units']:
        return (f"**The current schedule can cover {data['required_units']:,} units.** "
                f"Available capacity is {data['available_units']:,} units through day {data['required_day']}. "
                'Existing orders and maintenance are protected.')
    return (f"**Not with the current schedule.**\n\n{data['planned_line']} has "
            f"{windows or 'insufficient uncommitted capacity'} during the campaign packaging window "
            f"(days {data['planned_start_day']}–{data['required_day']}).\n\n"
            f"With existing orders protected, **{data['at_risk_units']:,} campaign units** are at risk "
            f"of missing day {data['required_day']}. Available capacity in that window: {data['available_units']:,}.\n\n"
            f"Sources: approved campaign **{case_id}**, daily line capacity, existing orders, {windows or 'capacity calendar'}. "
            'Ask me for alternatives that preserve maintenance and existing orders.')


def format_proposal(proposal_id, result):
    lines = {}
    for allocation in result['allocations']:
        line = lines.setdefault(allocation['line'], {'units': 0, 'days': []})
        line['units'] += allocation['units']
        line['days'].append(allocation['day'])
    details = '\n'.join(f"- **{name}: {value['units']:,} units**, days {min(value['days'])}–{max(value['days'])}."
                        for name, value in sorted(lines.items()))
    outcome = ('All campaign units meet the required date.' if result['feasible'] else
               f"**{result['uncovered_units']:,} units remain uncovered. This option cannot be approved.**")
    approval = (f"\n\nKarin: review proposal **{proposal_id}**, then reply **Approve production proposal {proposal_id}**."
                if result['feasible'] else '')
    return (f"**Production proposal {proposal_id}**\n\n{details}\n\n"
            f"Transfer to an alternate line: {result['transferred_percent']:g}% of campaign volume. "
            f"Work may start up to {result['bring_forward_days']} days earlier. "
            f"Maintenance and existing customer orders stay unchanged. {outcome}{approval}")


def approve(c, case_id, proposal_id, user_id):
    c.execute('LOCK TABLE factory.proposals, factory.allocations IN SHARE ROW EXCLUSIVE MODE')
    row = c.execute('SELECT * FROM factory.proposals WHERE id=%s AND case_id=%s FOR UPDATE', (proposal_id, case_id)).fetchone()
    if not row:
        raise ValueError('That proposal does not belong to this production case')
    facts = snapshot(c, case_id)
    if user_id != facts['case']['approval_user_id']:
        raise ValueError('Only Karin, the assigned factory supervisor, can approve this production revision')
    if row['approved_at']:
        return f"Production proposal **{proposal_id}** was already approved. No duplicate allocation was created."
    c.execute('LOCK TABLE factory.cases, factory.daily_capacity, factory.maintenance IN SHARE MODE')
    facts = snapshot(c, case_id)
    if fingerprint(facts) != row['snapshot_hash']:
        raise ValueError('The production facts changed. Ask for a new proposal before approving.')
    if not row['result']['feasible']:
        raise ValueError('Cannot approve a proposal with uncovered demand')
    already = c.execute('SELECT id FROM factory.proposals WHERE case_id=%s AND approved_at IS NOT NULL', (case_id,)).fetchone()
    if already:
        raise ValueError(f"This case already has approved proposal {already['id']}")
    recalculated = propose(facts, row['result']['bring_forward_days'], row['result']['allow_alternate_line'])
    if recalculated != row['result']:
        raise ValueError('Stored proposal failed recalculation')
    for allocation in recalculated['allocations']:
        c.execute('INSERT INTO factory.allocations VALUES(%s,%s,%s,%s)',
                  (proposal_id, allocation['line'], allocation['day'], allocation['units']))
    c.execute('UPDATE factory.proposals SET approved_by=%s,approved_at=clock_timestamp() WHERE id=%s', (user_id, proposal_id))
    return (f"**Production revision {proposal_id} approved and recorded.**\n\n"
            f"{recalculated['scheduled_units']:,} units are scheduled by day {recalculated['required_day']}. "
            'Maintenance MW-77 and existing customer orders are unchanged. '
            f"Tim, production capacity is confirmed for **{case_id}**.\n\n"
            'The saved revision includes the evaluated schedule, assumptions, and Karin’s approval identity.')


def classify(c, text, case_id):
    # The LLM interprets intent/constraints, never approves or invents capacity.
    document = f"Production case: {case_id}. Interpret only this user's request: {text}"
    result = c.execute("""SELECT azure_ai.extract(document => %s, data => %s, model => 'caldova-chat') AS intent""",
                       (document, [
                           'action: string - one of assess, alternatives, status, unsupported; asks what options or plans means alternatives; asks can the line meet demand means assess',
                           'bring_forward_days: integer - maximum days allowed earlier: default 3; if explicitly no earlier work use 0; never infer more than 3',
                           'allow_alternate_line: boolean - default true; false if user explicitly forbids PKG-01 or any other line',
                           'relax_protection: boolean - true only if user asks to move/cancel maintenance or displace existing customer orders'
                       ])).fetchone()['intent']
    if not isinstance(result, dict) or result.get('action') not in ('assess', 'alternatives', 'status', 'unsupported'):
        raise ValueError('I could not identify the planning request. Ask to assess capacity or compare alternatives.')
    return result


def handle(tenant_id, conversation_id, activity_id, user_id, text, default_case):
    with connect() as c:
        c.execute('SELECT pg_advisory_xact_lock(290391)')
        # Serialize this thread, preserve message idempotency and proposal context.
        c.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))', (tenant_id+conversation_id,))
        previous = c.execute('SELECT answer FROM factory.turns WHERE tenant_id=%s AND conversation_id=%s AND activity_id=%s',
                             (tenant_id, conversation_id, activity_id)).fetchone()
        if previous:
            return previous['answer']
        thread = c.execute('SELECT * FROM factory.threads WHERE tenant_id=%s AND conversation_id=%s', (tenant_id, conversation_id)).fetchone()
        c.execute('LOCK TABLE factory.cases,factory.daily_capacity,factory.maintenance,factory.allocations IN SHARE MODE')
        # Case references must exactly match a seeded case; no "latest plan" guess.
        cases = c.execute('SELECT case_id FROM factory.cases').fetchall()
        matches = [r['case_id'] for r in cases if r['case_id'].casefold() in text.casefold()]
        if len(matches) > 1:
            raise ValueError('Please specify one campaign case')
        case_id = matches[0] if matches else (thread['case_id'] if thread else default_case)
        if thread and matches and matches[0] != thread['case_id']:
            raise ValueError('Start a new thread to review a different campaign')
        facts = snapshot(c, case_id)
        c.execute('INSERT INTO factory.threads(tenant_id,conversation_id,case_id) VALUES(%s,%s,%s) ON CONFLICT DO NOTHING',
                  (tenant_id, conversation_id, case_id))
        approved = c.execute('SELECT id,approved_at FROM factory.proposals WHERE case_id=%s AND approved_at IS NOT NULL', (case_id,)).fetchone()
        approval = re.fullmatch(r'\s*approve production proposal\s+(\d+)\s*[.!]?\s*', text, re.I)
        if approval:
            proposal_id = int(approval.group(1))
            if not thread or thread['last_proposal_id'] != proposal_id:
                raise ValueError('Review this proposal in the current thread before approving it')
            answer = approve(c, case_id, proposal_id, user_id)
        elif re.search(r'\b(approve|approval|confirm|accept)\b', text, re.I) and thread and thread['last_proposal_id']:
            answer = (f"To record a production commitment, Karin must reply exactly: "
                      f"**Approve production proposal {thread['last_proposal_id']}**. "
                      'Questions about approval do not approve the plan.')
        elif approved:
            answer = f"Production capacity for **{case_id}** is confirmed by approved revision **{approved['id']}**. Maintenance and existing orders are protected."
        else:
            intent = classify(c, text, case_id)
            if intent.get('relax_protection') is True:
                answer = 'This planning case requires maintenance and existing customer commitments to remain protected. I can evaluate earlier work and compatible alternate-line capacity within those boundaries.'
            elif intent['action'] == 'alternatives':
                days = intent.get('bring_forward_days', 3)
                alternate = intent.get('allow_alternate_line', True)
                if type(days) is not int or type(alternate) is not bool:
                    raise ValueError('Please specify whether earlier production and PKG-01 are allowed')
                result = propose(facts, days, alternate)
                proposal_id = c.execute('''INSERT INTO factory.proposals(case_id,snapshot_hash,snapshot,result,created_by)
                    VALUES(%s,%s,%s,%s,%s) RETURNING id''',
                    (case_id, fingerprint(facts), Jsonb(facts), Jsonb(result), user_id)).fetchone()['id']
                c.execute('UPDATE factory.threads SET last_proposal_id=%s WHERE tenant_id=%s AND conversation_id=%s',
                          (proposal_id, tenant_id, conversation_id))
                answer = format_proposal(proposal_id, result)
            elif intent['action'] in ('assess', 'status'):
                answer = format_assessment(case_id, assess(facts))
            else:
                answer = 'I can assess the approved Hydration Sunscreen campaign, compare production alternatives, and record Karin’s reviewed approval. Ask whether PKG-03 can absorb the campaign demand.'
        c.execute('INSERT INTO factory.turns(tenant_id,conversation_id,activity_id,user_id,question,answer) VALUES(%s,%s,%s,%s,%s,%s)',
                  (tenant_id, conversation_id, activity_id, user_id, text, answer))
        return answer
