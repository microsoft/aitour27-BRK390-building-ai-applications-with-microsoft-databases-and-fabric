import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSqlResources, SQL_TIMEOUTS } from './sql-resources.mjs';

const transient = () => Object.assign(new Error('Unavailable'), { code: 'ESOCKET' });
class Pool extends EventEmitter {
  connected = false;
  closed = 0;
  cancelled = 0;
  executions = 0;
  healthChecks = 0;
  connectAction: () => Promise<unknown> = async () => {};
  healthAction: () => Promise<unknown> = async () => ({ recordset: [{ ready: 1 }] });
  requestAction: () => Promise<unknown> = async () => ({ recordset: [] });
  async connect() { await this.connectAction(); this.connected = true; return this; }
  async close() { this.closed++; this.connected = false; }
  request() {
    const pool = this;
    return { input() { return this; }, cancel() { pool.cancelled++; },
      async query(statement?: string) {
        if (statement === 'SELECT 1 AS ready') { pool.healthChecks++; return pool.healthAction(); }
        pool.executions++; return pool.requestAction();
      },
      async execute() { pool.executions++; return pool.requestAction(); } };
  }
}
function setup(pools: Pool[]) {
  let created = 0;
  const resources = createSqlResources({ createPool: () => pools[created++], createResources: pool => ({ pool }),
    timeouts: { connect: 15, request: 15, retryDelay: 0 }, delay: async () => {} });
  return { resources, created: () => created };
}

test('transient initial connection retries once and concurrent callers share recovery', async () => {
  const failed = new Pool(); failed.connectAction = async () => { throw transient(); };
  const good = new Pool(); const state = setup([failed, good]);
  const [first, second] = await Promise.all([state.resources(), state.resources()]);
  assert.equal(first, second); assert.equal(state.created(), 2); assert.equal(failed.closed, 1);
});

test('connection stalls time out twice and later requests can reconnect', async () => {
  const first = new Pool(); first.connectAction = () => new Promise(() => {});
  const second = new Pool(); second.connectAction = first.connectAction;
  const state = setup([first, second, new Pool()]);
  await assert.rejects(state.resources(), { code: 'ETIMEOUT' });
  assert.equal(first.closed, 1); assert.equal(second.closed, 1);
  await state.resources(); assert.equal(state.created(), 3);
});

test('authentication/configuration failure is not retried', async () => {
  const failed = new Pool(); failed.connectAction = async () => { throw Object.assign(new Error('Login'), { code: 'ELOGIN' }); };
  const state = setup([failed]);
  await assert.rejects(state.resources(), { code: 'ELOGIN' }); assert.equal(state.created(), 1);
});

test('a stale pool error cannot discard its replacement', async () => {
  const old = new Pool(); const replacement = new Pool(); const state = setup([old, replacement]);
  await state.resources(); old.emit('error', transient());
  const ready = await state.resources(); old.emit('error', transient());
  assert.equal(await state.resources(), ready); assert.equal(replacement.closed, 0);
});

test('request acquisition or execution stalls are cancelled without replaying a write', async () => {
  const stalled = new Pool(); stalled.requestAction = () => new Promise(() => {});
  const state = setup([stalled, new Pool()]); const resource = await state.resources();
  await assert.rejects(resource.pool.request().input('requestId', 'retained').execute('act3.approve_option'), { code: 'ETIMEOUT' });
  assert.equal(stalled.executions, 1); assert.equal(stalled.cancelled, 1);
  await state.resources(); assert.equal(state.created(), 2);
});

test('broken request reconnects on the next call; business rejection keeps healthy pool', async () => {
  const pool = new Pool(); const state = setup([pool, new Pool()]);
  const resource = await state.resources();
  pool.requestAction = async () => { throw { number: 51002 }; };
  await assert.rejects(resource.pool.request().execute('act3.approve_option'));
  assert.equal(await state.resources(), resource); assert.equal(pool.closed, 0);
  pool.requestAction = async () => { throw transient(); };
  await assert.rejects(resource.pool.request().query('SELECT 1'));
  assert.notEqual(await state.resources(), resource); assert.equal(state.created(), 2);
});

test('a late connection is closed without displacing the recovered pool', async () => {
  let finish: () => void = () => {};
  const late = new Pool();
  late.connectAction = () => new Promise<void>(resolve => { finish = resolve; });
  const replacement = new Pool(); const state = setup([late, replacement]);
  const ready = await state.resources();
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(late.connected, false); assert.equal(late.closed, 2);
  assert.equal(await state.resources(), ready); assert.equal(replacement.closed, 0);
});

test('a disconnected pool is replaced even without an error event', async () => {
  const pool = new Pool(); const state = setup([pool, new Pool()]);
  const first = await state.resources(); pool.connected = false;
  assert.notEqual(await state.resources(), first); assert.equal(pool.closed, 1);
});

test('an idle pool that still reports connected recovers before returning resources', async () => {
  const idle = new Pool(); const replacement = new Pool(); const state = setup([idle, replacement]);
  await state.resources();
  idle.healthAction = async () => { throw { number: 40613 }; };
  assert.equal(idle.connected, true);
  const [first, second] = await Promise.all([state.resources(), state.resources()]);
  assert.equal(first, second); assert.equal(state.created(), 2);
  assert.equal(idle.healthChecks, 1); assert.equal(idle.closed, 1);
  assert.equal(idle.executions + replacement.executions, 0);
});

test('a stalled cached-pool check is cancelled before recovery', async () => {
  const idle = new Pool(); const state = setup([idle, new Pool()]);
  await state.resources();
  idle.healthAction = () => new Promise(() => {});
  await state.resources();
  assert.equal(idle.cancelled, 1); assert.equal(idle.closed, 1);
  assert.equal(state.created(), 2); assert.equal(idle.executions, 0);
});

test('default recovery survives a one-minute serverless resume without executing a query', async () => {
  let elapsed = 0;
  const pools: Pool[] = [];
  const resources = createSqlResources({
    createPool: () => {
      const pool = new Pool(); pools.push(pool);
      pool.connectAction = async () => {
        if (elapsed < 60_000) throw { code: 'ELOGIN', originalError: { info: { number: 40613 } } };
      };
      return pool;
    }, createResources: pool => ({ pool }), now: () => elapsed,
    delay: async milliseconds => { elapsed += milliseconds; },
  });
  const [first, second] = await Promise.all([resources(), resources()]);
  assert.equal(first, second); assert.equal(elapsed, 60_000);
  assert.equal(pools.length, 13);
  assert.ok(pools.every(pool => pool.executions === 0));
  assert.ok(pools.slice(0, -1).every(pool => pool.closed === 1));
});

test('default recovery stops within its total budget when SQL remains unavailable', async () => {
  let elapsed = 0;
  let attempts = 0;
  const resources = createSqlResources({
    createPool: () => {
      attempts++;
      const pool = new Pool();
      pool.connectAction = async () => { throw { number: 40613 }; };
      return pool;
    }, createResources: pool => ({ pool }), now: () => elapsed,
    delay: async milliseconds => { elapsed += milliseconds; },
  });
  await assert.rejects(resources(), { number: 40613 });
  assert.equal(attempts, 14); assert.equal(elapsed, 65_000);
  assert.ok(elapsed <= SQL_TIMEOUTS.recovery);
});