export class YahooSessionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const fail = code => new YahooSessionError(code);
const hasToken = value => typeof value === 'string' && value.trim().length > 0;

function usable(session, now) {
  return hasToken(session?.access_token) && Number.isFinite(session.expires_at) && session.expires_at > now + 120000;
}

function renewedSession(response, previous, startedAt) {
  const seconds = Number(response?.expires_in);
  if (!hasToken(response?.access_token) || !Number.isFinite(seconds) || seconds <= 120 || seconds > 86400 ||
      (response.token_type !== undefined && String(response.token_type).toLowerCase() !== 'bearer') ||
      (response.refresh_token !== undefined && !hasToken(response.refresh_token))) throw fail('invalid_refresh_response');
  return {
    access_token: response.access_token,
    refresh_token: response.refresh_token ?? previous.refresh_token,
    expires_at: startedAt + seconds * 1000
  };
}

// Every instance uses the same durable per-session claim before exchanging tokens.
// A missing/expired claim is never taken over after an exchange may have started.
export function createYahooSessionClient(owner, {store, exchange, read, now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  let session = owner?.tokens;
  let pending;
  let refreshAttempted = false;
  let refreshed = false;
  let coordinationAttempted = false;
  if (!owner?.hash || !hasToken(session?.refresh_token)) throw fail('owner_authorization_unavailable');

  async function persist(claim, replacement) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (await store.finish(claim, replacement)) return;
        throw fail('session_changed_during_refresh');
      } catch (error) {
        if (error?.code === 'session_changed_during_refresh') throw error;
        if (attempt < 2) await pause(100 * (attempt + 1));
      }
    }
    throw fail('refresh_save_failed');
  }

  async function uncertain(claim) {
    try { await store.uncertain(claim); } catch { /* The durable claim remains held and expires to uncertain. */ }
  }

  async function renew({force = false, rejectedToken} = {}) {
    if (!force && !rejectedToken && usable(session, now())) return;
    const observedAccess = session.access_token;
    const observedRefresh = session.refresh_token;
    const observedExpiry = session.expires_at;
    const waitUntil = now() + 25000;
    let claim;
    for (let attempt = 0; attempt < 100 && now() < waitUntil; attempt++) {
      let candidate;
      coordinationAttempted = true;
      try { candidate = await store.claim(owner.hash); }
      catch { throw fail('refresh_store_unavailable'); }
      if (candidate.state === 'uncertain') throw fail('refresh_outcome_uncertain');
      if (candidate.state === 'missing') throw fail('owner_authorization_unavailable');
      if (candidate.state === 'busy') { await pause(250); continue; }
      if (candidate.state !== 'acquired') throw fail('refresh_store_unavailable');
      claim = candidate;
      break;
    }
    if (!claim) throw fail('refresh_busy');
    const latest = claim.tokens;
    const changed = latest?.access_token !== (rejectedToken ?? observedAccess) ||
      latest?.refresh_token !== observedRefresh || latest?.expires_at !== observedExpiry;
    if (usable(latest, now()) && (changed || (!force && !rejectedToken))) {
      await persist(claim, null);
      session = latest;
      return;
    }
    if (!hasToken(latest?.refresh_token)) {
      await persist(claim, null);
      throw fail('owner_authorization_unavailable');
    }

    let replacement;
    refreshAttempted = true;
    try {
      const startedAt = now();
      replacement = renewedSession(await exchange(latest.refresh_token), latest, startedAt);
    } catch (error) {
      await uncertain(claim);
      throw fail(error?.code === 'invalid_refresh_response' ? error.code : 'refresh_outcome_uncertain');
    }
    try {
      await persist(claim, replacement);
    } catch (error) {
      await uncertain(claim);
      throw error;
    }
    session = replacement;
    refreshed = true;
  }

  async function ready(options = {}) {
    // Also coalesce parallel reads made by a single client. The DB claim covers other clients/instances.
    if (pending) return pending;
    pending = renew(options);
    try { await pending; } finally { pending = undefined; }
  }

  return {
    ready,
    get refreshAttempted() { return refreshAttempted; },
    get refreshed() { return refreshed; },
    get coordinationAttempted() { return coordinationAttempted; },
    async read(path) {
      await ready();
      const used = session.access_token;
      try { return await read(used, path); }
      catch (error) {
        if (error?.status !== 401) throw error;
        await ready({rejectedToken: used});
        return read(session.access_token, path);
      }
    }
  };
}
