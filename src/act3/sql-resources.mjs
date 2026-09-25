export const SQL_TIMEOUTS = Object.freeze({ connect: 12_000, request: 12_000, retryDelay: 5_000, recovery: 70_000 });

const transientCodes = new Set(['ETIMEOUT', 'ESOCKET', 'ECONNCLOSED', 'ENOTOPEN', 'ECONNRESET', 'EINSTLOOKUP']);
const transientNumbers = new Set([40613, 40197, 40501, 10928, 10929, 49918, 49919, 49920]);

export function isTransientSqlError(error) {
  return transientCodes.has(error?.code) || transientNumbers.has(error?.number)
    || transientNumbers.has(error?.originalError?.info?.number);
}

function deadline(operation, milliseconds, cancel) {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        const error = Object.assign(new Error('SQL operation timed out.'), { code: 'ETIMEOUT' });
        reject(error);
        try { cancel(); } catch {}
      }, milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function createSqlResources({ createPool, createResources, timeouts = SQL_TIMEOUTS, log = () => {},
  delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), now = Date.now }) {
  let current;
  const close = pool => { try { void Promise.resolve(pool.close()).catch(() => {}); } catch {} };
  const invalidate = entry => {
    if (current === entry) current = undefined;
    if (!entry.disposed) {
      entry.disposed = true;
      close(entry.pool);
    }
  };
  const connect = async () => {
    const expires = now() + (timeouts.recovery ?? (timeouts.connect * 2 + timeouts.retryDelay));
    for (let attempt = 1; ; attempt++) {
      const entry = current;
      if (entry) {
        let request;
        const started = Date.now();
        try {
          request = entry.pool.request();
          await deadline(() => request.query('SELECT 1 AS ready'),
            Math.min(timeouts.connect, Math.max(1, expires - now())), () => {
              try { request.cancel(); } finally { invalidate(entry); }
            });
          return await entry.promise;
        } catch (error) {
          log('sql.readiness.failed', { code: error?.code || 'SQL_ERROR', durationMs: Date.now() - started });
          if (!isTransientSqlError(error)) throw error;
          invalidate(entry);
          if (expires - now() <= timeouts.retryDelay
            || (timeouts.recovery === undefined && attempt === 2)) throw error;
          await delay(timeouts.retryDelay);
          continue;
        }
      }
      const pool = createPool();
      const next = { pool, disposed: false, promise: undefined };
      current = next;
      pool.on('error', error => {
        log('sql.pool.error', { code: error?.code || 'SQL_ERROR' });
        invalidate(next);
      });
      next.promise = (async () => {
        const started = Date.now();
        try {
          await deadline(async () => {
            await pool.connect();
            if (next.disposed) close(pool);
          }, Math.min(timeouts.connect, Math.max(1, expires - now())), () => invalidate(next));
          if (next.disposed) {
            close(pool);
            throw Object.assign(new Error('SQL connection was discarded.'), { code: 'ECONNCLOSED' });
          }
          const managedPool = {
            request() {
              const request = pool.request();
              for (const method of ['query', 'execute']) {
                const original = request[method].bind(request);
                request[method] = async (...args) => {
                  const began = Date.now();
                  try {
                    return await deadline(() => original(...args), timeouts.request, () => {
                      try { request.cancel(); } finally { invalidate(next); }
                    });
                  } catch (error) {
                    if (isTransientSqlError(error)) invalidate(next);
                    log('sql.request.failed', { method, code: error?.code || 'SQL_ERROR', durationMs: Date.now() - began });
                    throw error;
                  }
                };
              }
              return request;
            },
          };
          log('sql.connect.ready', { attempt, durationMs: Date.now() - started });
          return createResources(managedPool);
        } catch (error) {
          invalidate(next);
          log('sql.connect.failed', { attempt, code: error?.code || 'SQL_ERROR', durationMs: Date.now() - started });
          throw error;
        }
      })();
      try { return await next.promise; }
      catch (error) {
        const remaining = expires - now();
        if (!isTransientSqlError(error) || remaining <= timeouts.retryDelay
          || (timeouts.recovery === undefined && attempt === 2)) throw error;
        await delay(timeouts.retryDelay);
      }
    }
  };
  let connecting;
  return () => {
    if (connecting) return connecting;
    if (current && (current.disposed || current.pool.connected === false)) invalidate(current);
    connecting = connect().finally(() => { connecting = undefined; });
    return connecting;
  };
}