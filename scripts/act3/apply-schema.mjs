import { readFileSync } from 'node:fs';
import { connect } from './staffing-admin.mjs';

const pool = await connect();
try {
  for (const name of ['001_guidance.sql', '002_review.sql', '003_staffing.sql']) {
    const text = readFileSync(new URL(`../../src/act3/sql/${name}`, import.meta.url), 'utf8');
    for (const batch of text.split(/^GO\s*$/mi).filter(value => value.trim())) await pool.request().batch(batch);
  }
  console.log('Applied demo schema. Existing cases and approvals were preserved.');
} finally { await pool.close(); }