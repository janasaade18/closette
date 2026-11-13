import { json, optionsResponse, requireAdmin } from '../_shared/requireAdmin.ts';

Deno.serve(async (req) => {
  const options = optionsResponse(req);
  if (options) return options;

  const gate = await requireAdmin(req);
  if ('error' in gate) return gate.error;
  const { service } = gate;

  const body = await req.json().catch(() => null);
  const userId = String(body?.userId ?? '');
  const password = String(body?.password ?? '');
  if (!userId) return json({ error: 'Choose a user.' }, 400);
  if (password.length < 6) {
    return json({ error: 'Password must be at least 6 characters.' }, 400);
  }

  const { data: person, error: loadError } = await service
    .from('users')
    .select('id, email')
    .eq('id', userId)
    .maybeSingle();
  if (loadError) return json({ error: loadError.message }, 400);
  if (!person) return json({ error: 'User not found.' }, 404);

  const { error } = await service.auth.admin.updateUserById(userId, { password });
  if (error) return json({ error: error.message }, 400);

  return json({
    userId,
    ownerEmail: person.email,
    temporaryPassword: password,
  });
});
