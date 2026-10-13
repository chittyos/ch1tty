/** Normalize known client aliases before the MCP SDK's exact tool lookup.
 * Called only after transport authentication; SDK argument validation stays intact.
 */
export async function normalizeMcpRequest(req: Request): Promise<Request> {
  if (req.method !== 'POST' || !req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return req;
  let body: unknown;
  try { body = await req.clone().json(); } catch { return req; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return req;
  const rpc = body as Record<string, unknown>;
  if (rpc.method !== 'tools/call' || !rpc.params || typeof rpc.params !== 'object' || Array.isArray(rpc.params)) return req;
  const params = rpc.params as Record<string, unknown>;
  if (typeof params.name !== 'string') return req;
  const match = /^(?:ch1tty[/.](?:ch1tty[/.])?)?(search|execute|status|cast|code|provision|memory_recall|memory_ingest|memory_summary)$/i.exec(params.name);
  const canonical = params.name === 'gateway_status' ? 'ch1tty/status' : match ? `ch1tty/${match[1]}` : params.name;
  if (canonical === params.name) return req;
  params.name = canonical;
  const headers = new Headers(req.headers);
  headers.delete('content-length');
  return new Request(req, { headers, body: JSON.stringify(rpc) });
}
