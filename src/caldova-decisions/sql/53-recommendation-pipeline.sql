\set ON_ERROR_STOP on
SELECT ai.create_pipeline(
    name => 'caldova_recommendation_usd_v1',
    source => ai.table_source(table_name => 'usd_context', schema_name => 'caldova', incremental_column => 'updated_at'),
    steps => ARRAY[
        ai.chunk(input => 'content', chunk_size => 16000, overlap => 0),
        ai.extract(input => 'chunk_text', model => :'model_alias', data => ARRAY[
            'evaluation_id: integer - exact evaluation_id from the input JSON'
        ]),
        ai.generate(input => 'chunk_text', model => :'model_alias', max_tokens => 1600,
            system_prompt => 'Write a concise decision brief for Tim using only selected_result and comparison. '
            'Use six short bullet points: '
            '1. Recommended scenario and total extra budget in USD. All amounts are US dollars. '
            '2. Incremental units, proposed total units, and exact uplift_percent from SQL (rounded). Never recalculate. '
            '3. Funded regions and their budgets. '
            '4. Other options: current is eligible if its own eligible field is true; broad eligibility follows its own checks. '
            '5. Low/high total incremental units and evidence confidence; weather and response assumptions; policy reference. '
            '6. Launch stock versus six-week production gap: exact production_gap_units requiring confirmation, including zero. '
            'Use business language, no JSON field names. Do not invent maintenance, delivery, or approval. '
            'End with the exact sentence: Marketing approval pending.'),
        ai.extract(input => 'generated_text', model => :'model_alias', data => ARRAY[
            'extra_budget_usd: number - total additional budget in US dollars recommended in this brief',
            'incremental_units: integer - total additional campaign units recommended',
            'proposed_units: integer - total demand including baseline',
            'uplift_percent: number - percentage uplift explicitly stated in the brief',
            'production_gap_units: integer - total units requiring production confirmation',
            'current_option_eligible: boolean - true unless the brief explicitly says the current/no-extra-spend option is ineligible'
        ])
    ],
    sink => ai.table_sink(table_name => 'usd_briefs', schema_name => 'caldova'),
    trigger => 'manual'
);
SELECT ai.explain('caldova_recommendation_usd_v1');
