import { json, optionsResponse, requireAdmin } from '../_shared/requireAdmin.ts';

Deno.serve(async (req) => {
  const options = optionsResponse(req);
  if (options) return options;

  const gate = await requireAdmin(req);
  if ('error' in gate) return gate.error;
  const { userId: callerId, service } = gate;

  const body = await req.json().catch(() => null);
  const userId = String(body?.userId ?? '');
  const active = Boolean(body?.active);
  if (!userId) return json({ error: 'Choose a user.' }, 400);
  if (userId === callerId) {
    return json({ error: 'You cannot change your own access.' }, 400);
  }

  const { data: person, error: loadError } = await service
    .from('users')
    .select('id, role, disabled_at')
    .eq('id', userId)
    .maybeSingle();
  if (loadError) return json({ error: loadError.message }, 400);
  if (!person) return json({ error: 'User not found.' }, 404);

  if (!active && person.role === 'admin') {
    const { count, error: countError } = await service
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .is('disabled_at', null);
    if (countError) return json({ error: countError.message }, 400);
    if ((count ?? 0) <= 1) {
      return json({ error: 'The last admin cannot be removed.' }, 400);
    }
  }

  const { error: banError } = await service.auth.admin.updateUserById(userId, {
    ban_duration: active ? 'none' : '876000h',
  });
  if (banError) return json({ error: banError.message }, 400);

  const { data, error } = await service
    .from('users')
    .update({ disabled_at: active ? null : new Date().toISOString() })
    .eq('id', userId)
    .select('id, email, display_name, role, created_at, disabled_at')
    .single();
  if (error) return json({ error: error.message }, 400);

  return json({ user: data });
});
