import type { SupabaseClient } from '@supabase/supabase-js';

/** Registration and required attachment link commit together in the database. */
export async function registerFile(client: SupabaseClient, values: Record<string, unknown>) {
  return client.rpc('crm_register_private_file', { p_file: values });
}
