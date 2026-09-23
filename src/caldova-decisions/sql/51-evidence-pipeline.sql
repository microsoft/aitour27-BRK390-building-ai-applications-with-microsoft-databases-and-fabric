\set ON_ERROR_STOP on
SELECT ai.create_pipeline(
    name => 'caldova_evidence_v3',
    source => ai.table_source(table_name => 'evidence_packets', schema_name => 'caldova', incremental_column => 'updated_at'),
    steps => ARRAY[
        ai.chunk(input => 'content', chunk_size => 8192, overlap => 0),
        ai.extract(input => 'chunk_text', model => :'model_alias', data => ARRAY[
            'source_reference: string - exact Evidence reference from the first line',
            'outlook_weeks: integer - number of weeks of elevated demand; null for a policy document',
            'demand_supported: boolean - whether the outlook supports additional advertising; null for a policy document',
            'assumptions: string - forecast conditions or commercial requirements stated in the document'
        ])
    ],
    sink => ai.table_sink(table_name => 'linked_evidence', schema_name => 'caldova'),
    trigger => 'manual'
);
SELECT ai.explain('caldova_evidence_v3');
