export function deliveryMessage(data: { success?: boolean; status?: string } | null) {
  if (data?.success) return 'Provider accepted this email. Recipient delivery is not confirmed.';
  if (data?.status === 'busy') return 'This document send is already in progress.';
  if (data?.status === 'failed') return 'The provider rejected this request. Review delivery history.';
  return 'The outcome is uncertain. Do not start another send; review delivery history or contact the division owner.';
}
