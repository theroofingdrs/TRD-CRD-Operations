// Provider transport is injected in tests. No recipient-delivery claim is made.
export async function deliverOperation(operation: any, apiKey: string, finish: (status: string, provider: string | null, error: string | null) => Promise<void>, transport: typeof fetch = fetch) {
  if (operation.action !== 'send') return { success: operation.status === 'accepted', status: operation.status || operation.action, delivery_id: operation.id };
  let status = 'uncertain'; let provider: string | null = null; let error: string | null = null;
  try {
    const response = await transport('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'Idempotency-Key': operation.key },
      body: operation.body, signal: AbortSignal.timeout(20000), redirect: 'error',
    });
    const result = await response.json().catch(() => null);
    if (response.ok && typeof result?.id === 'string' && result.id) { status = 'accepted'; provider = result.id; }
    // Only documented validation/auth rejection is definitive. 409, 429, 5xx,
    // malformed success and network failures retain the same operation/key.
    else if ([400,401,403,422].includes(response.status)) { status = 'failed'; error = 'Provider rejected request (' + response.status + ').'; }
    else error = 'Provider outcome requires reconciliation (' + response.status + ').';
  } catch { error = 'Provider outcome unknown after transport failure.'; }
  // Persistence errors MUST propagate; never report acceptance without durable state.
  await finish(status, provider, error);
  return { success: status === 'accepted', status, delivery_id: operation.id, provider_message_id: provider };
}

export function requiredParent(value: any, id: string) {
  // FK-to-parent embeddings are objects. Accept a singleton array only as a
  // compatibility adapter, never silently choose one of several records.
  const row = Array.isArray(value) ? value.length === 1 ? value[0] : null : value;
  if (!row || row.id !== id) throw new Error('Missing or ambiguous document relationship.');
  return row;
}

export async function verifyRecovery(operation: any, providerId: string, key: string, transport: typeof fetch = fetch) {
  if (!/^[0-9a-f-]{36}$/i.test(providerId)) throw new Error('Invalid provider email ID.');
  const response = await transport('https://api.resend.com/emails/' + providerId, {
    headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(10000), redirect: 'error',
  });
  if (!response.ok) throw new Error('Provider evidence unavailable. No resend was attempted.');
  const email = await response.json(); const expected = JSON.parse(operation.body);
  if (email.id !== providerId || JSON.stringify(email.to) !== JSON.stringify(expected.to) || email.from !== expected.from || email.subject !== expected.subject
    || email.html !== expected.html || !email.tags?.some((t: any) => t.name === 'crm_operation' && t.value === operation.id)) {
    throw new Error('Provider email does not match this immutable operation.');
  }
  return typeof email.last_event === 'string' ? email.last_event : 'unknown';
}
