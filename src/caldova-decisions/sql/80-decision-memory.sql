\set ON_ERROR_STOP on
CREATE TABLE IF NOT EXISTS factory.memory_outbox (
    proposal_id integer PRIMARY KEY REFERENCES factory.proposals,
    status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
    attempts integer NOT NULL DEFAULT 0,
    snapshot jsonb,
    captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz,
    error text
);
CREATE OR REPLACE FUNCTION factory.queue_decision_memory() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.approved_at IS NOT NULL AND OLD.approved_at IS NULL THEN
   INSERT INTO factory.memory_outbox(proposal_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER capture_production_decision AFTER UPDATE OF approved_at ON factory.proposals
FOR EACH ROW EXECUTE FUNCTION factory.queue_decision_memory();
