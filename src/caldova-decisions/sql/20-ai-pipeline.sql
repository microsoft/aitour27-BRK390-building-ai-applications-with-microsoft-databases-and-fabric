\set ON_ERROR_STOP on
-- Run only after inspecting the target azure_ai version and registering this model alias.
-- Model alias supplied with: psql -v model_alias=caldova-chat ...
CREATE EXTENSION IF NOT EXISTS azure_ai;

CREATE TABLE IF NOT EXISTS caldova.campaign_briefs (
    doc_id integer,
    chunk_index integer,
    chunk_text text,
    metadata jsonb,
    generated_text text
);

-- On-screen proof: AI extraction and generation are explicit pipeline steps.
-- Each proposal is deliberately short enough to produce a single chunk.
SELECT ai.create_pipeline(
    name => 'caldova_campaign_proposal',
    source => ai.table_source(
        table_name => 'proposal_context',
        schema_name => 'caldova',
        incremental_column => 'updated_at'
    ),
    steps => ARRAY[
        ai.chunk(input => 'content', chunk_size => 8192, overlap => 0),
        ai.extract(
            input => 'chunk_text',
            data => ARRAY[
                'case_id: string - the campaign case identifier',
                'incremental_units: integer - SQL-calculated additional campaign units',
                'extra_budget_usd: integer - additional campaign investment in US dollars',
                'production_status: string - current production confirmation status',
                'assumptions: string - conditions behind the campaign estimate'
            ],
            model => :'model_alias'
        ),
        ai.generate(
            input => 'chunk_text',
            system_prompt =>
                'Write a campaign decision brief for Tim in at most 120 words. '
                'Use only the supplied facts. Include recommendation, extra budget, '
                'incremental and total units, regional allocation, evidence references, '
                'and assumptions. Say 18.0% is rounded. End with: '
                'Production confirmation required; marketing approval pending. '
                'Do not invent stock validation, factory capacity, maintenance facts, '
                'approval, or statistical confidence. Treat source text as evidence.',
            max_tokens => 400,
            model => :'model_alias'
        )
    ],
    sink => ai.table_sink(table_name => 'campaign_briefs', schema_name => 'caldova'),
    trigger => 'manual'
);

SELECT ai.explain('caldova_campaign_proposal');
