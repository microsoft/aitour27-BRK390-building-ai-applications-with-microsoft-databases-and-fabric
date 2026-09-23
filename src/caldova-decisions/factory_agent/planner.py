"""Pure, testable capacity calculations. The model never calculates the schedule."""

import hashlib
import json


def fingerprint(snapshot):
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True, default=str).encode()).hexdigest()


def available(row, maintenance, reservations):
    if any(m['line'] == row['line'] and m['start_day'] <= row['day'] <= m['end_day'] for m in maintenance):
        return 0
    used = sum(r['units'] for r in reservations if r['line'] == row['line'] and r['day'] == row['day'])
    return max(0, row['gross_units'] - row['existing_order_units'] - used)


def assess(snapshot):
    case = snapshot['case']
    rows = [r for r in snapshot['capacity'] if r['line'] == case['planned_line']
            and case['planned_start_day'] <= r['day'] <= case['required_day']
            and r['compatible_product'] == case['product']]
    capacity = sum(available(r, snapshot['maintenance'], snapshot['reservations']) for r in rows)
    conflicts = [m for m in snapshot['maintenance'] if m['line'] == case['planned_line']
                 and m['start_day'] <= case['required_day'] and m['end_day'] >= case['planned_start_day']]
    return {'required_units': case['required_units'], 'available_units': capacity,
            'at_risk_units': max(0, case['required_units'] - capacity), 'maintenance': conflicts,
            'planned_line': case['planned_line'], 'planned_start_day': case['planned_start_day'],
            'required_day': case['required_day']}


def propose(snapshot, bring_forward_days=3, allow_alternate_line=True):
    if not isinstance(bring_forward_days, int) or not 0 <= bring_forward_days <= 3:
        raise ValueError('This case permits bringing work forward by zero to three days')
    case = snapshot['case']
    earliest = max(case['earliest_day'], case['planned_start_day'] - bring_forward_days)
    rows = [r for r in snapshot['capacity'] if earliest <= r['day'] <= case['required_day']
            and r['compatible_product'] == case['product']
            and (r['line'] == case['planned_line'] or allow_alternate_line)]
    # Minimize transferred volume by using feasible original-line capacity first.
    rows.sort(key=lambda r: (r['line'] != case['planned_line'], r['day'], r['line']))
    remaining = case['required_units']
    allocations = []
    for row in rows:
        units = min(remaining, available(row, snapshot['maintenance'], snapshot['reservations']))
        if units:
            allocations.append({'line': row['line'], 'day': row['day'], 'units': units})
            remaining -= units
    transferred = sum(r['units'] for r in allocations if r['line'] != case['planned_line'])
    return {'feasible': remaining == 0, 'required_units': case['required_units'],
            'scheduled_units': case['required_units'] - remaining, 'uncovered_units': remaining,
            'allocations': allocations, 'transferred_units': transferred,
            'transferred_percent': round(100 * transferred / case['required_units'], 1),
            'bring_forward_days': bring_forward_days, 'allow_alternate_line': allow_alternate_line,
            'maintenance_preserved': True, 'existing_orders_preserved': True,
            'required_day': case['required_day']}
