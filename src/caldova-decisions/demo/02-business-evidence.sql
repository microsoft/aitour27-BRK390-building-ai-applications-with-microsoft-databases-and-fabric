SELECT region,baseline_units,stock_units-reserved_units AS unreserved_stock,
       confirmed_receipts,channel_headroom AS channel_headroom_usd
FROM caldova.market_facts ORDER BY region;

SELECT region,count(*) AS comparable_campaigns,
       round(avg(incremental_units/extra_spend),2) AS extra_units_per_usd
FROM caldova.campaign_history GROUP BY region ORDER BY region;

SELECT policy_id,version,status,max_extra_budget,min_comparisons,wording
FROM caldova.commercial_policies;

SELECT source_reference,content FROM caldova.decision_documents
WHERE region IS NOT NULL OR source_reference IN
 (SELECT policy_id || '-v' || version FROM caldova.commercial_policies) ORDER BY id;
