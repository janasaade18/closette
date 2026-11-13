import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function optionsResponse(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}

export async function requireAdmin(req: Request): Promise<
  | { error: Response }
  | { userId: string; service: SupabaseClient }
> {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const header = req.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || !url || !anonKey || !serviceKey) {
    return { error: json({ error: 'Sign in as an admin first.' }, 401) };
  }

  const userClient = createClient(url, anonKey);
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) {
    return { error: json({ error: 'Sign in as an admin first.' }, 401) };
  }

  const service = createClient(url, serviceKey);
  const { data: profile, error: profileError } = await service
    .from('users')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle();
  if (profileError) {
    return { error: json({ error: profileError.message }, 500) };
  }
  if (profile?.role !== 'admin') {
    return { error: json({ error: 'Only an admin can do that.' }, 403) };
  }

  return { userId: data.user.id, service };
}

export async function requireUser(req: Request): Promise<
  | { error: Response }
  | { userId: string; email: string; service: SupabaseClient; anon: SupabaseClient }
> {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const header = req.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || !url || !anonKey || !serviceKey) {
    return { error: json({ error: 'Sign in first.' }, 401) };
  }

  const anon = createClient(url, anonKey);
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user?.email) {
    return { error: json({ error: 'Sign in first.' }, 401) };
  }

  return {
    userId: data.user.id,
    email: data.user.email,
    service: createClient(url, serviceKey),
    anon,
  };
}
