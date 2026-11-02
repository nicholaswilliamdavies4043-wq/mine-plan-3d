/**
 * Keep-alive: Render's free web services sleep after 15 minutes without incoming traffic. The
 * server requests its own public health URL every few minutes (11 by default) so it stays awake.
 * The request goes out through the public URL on purpose: traffic to localhost does not count.
 *
 * On by default on Render (RENDER_EXTERNAL_URL is set there). Elsewhere set KEEP_ALIVE_URL to
 * the app's public address. KEEP_ALIVE=false turns it off; KEEP_ALIVE_MINUTES changes the interval.
 */
export interface KeepAliveStatus {
  enabled: boolean;
  url: string | null;
  intervalMinutes: number;
  lastPingAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
}

const base = (process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
const minutes = Math.max(1, Number(process.env.KEEP_ALIVE_MINUTES) || 11);
const enabled = process.env.KEEP_ALIVE !== 'false' && !!base;

const status: KeepAliveStatus = {
  enabled, url: enabled ? `${base}/api/health` : null, intervalMinutes: minutes, lastPingAt: null, lastOk: null, lastError: null,
};

export const keepAliveStatus = (): KeepAliveStatus => ({ ...status });

async function ping() {
  if (!status.url) return;
  status.lastPingAt = new Date().toISOString();
  try {
    const r = await fetch(status.url, { headers: { 'user-agent': 'mdt-keep-alive', 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
    const wasFailing = status.lastOk === false;
    status.lastOk = r.ok;
    status.lastError = r.ok ? null : `HTTP ${r.status}`;
    if (!r.ok || wasFailing) console.log(`[keep-alive] ${status.url} answered ${r.status}`);
  } catch (e: any) {
    status.lastOk = false;
    status.lastError = e?.message ?? 'request failed';
    console.warn(`[keep-alive] ${status.url} failed: ${status.lastError}`);
  }
}

/** Start pinging (no-op when disabled). */
export function startKeepAlive() {
  if (!enabled) return;
  console.log(`[keep-alive] pinging ${status.url} every ${minutes} min`);
  const t = setInterval(ping, minutes * 60 * 1000);
  t.unref(); // never keep the process alive on its own
  setTimeout(ping, 60 * 1000).unref(); // first check a minute after start-up
}
