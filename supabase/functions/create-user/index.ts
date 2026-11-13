import { json, optionsResponse, requireAdmin } from '../_shared/requireAdmin.ts';

Deno.serve(async (req) => {
  const options = optionsResponse(req);
  if (options) return options;

  const gate = await requireAdmin(req);
  if ('error' in gate) return gate.error;
  const { service } = gate;

  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? '').trim();
  const email = String(body?.email ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');
  if (!name) return json({ error: 'Enter a name.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Enter a valid email.' }, 400);
  }
  if (password.length < 6) {
    return json({ error: 'Temporary password must be at least 6 characters.' }, 400);
  }

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (createError || !created.user) {
    const message = createError?.message ?? 'Could not create the user.';
    const status = /already|registered|exists/i.test(message) ? 409 : 400;
    return json(
      { error: status === 409 ? 'That email already has an account.' : message },
      status,
    );
  }

  const ownerId = created.user.id;
  const profile = {
    email,
    display_name: name,
    role: 'user',
    onboarding_completed_at: new Date().toISOString(),
    disabled_at: null,
  };
  const { data: updated, error: updateError } = await service
    .from('users')
    .update(profile)
    .eq('id', ownerId)
    .select('id, email, display_name, role, created_at, disabled_at');
  if (updateError) {
    await service.auth.admin.deleteUser(ownerId);
    return json({ error: updateError.message }, 400);
  }
  let user = updated?.[0];
  if (!user) {
    const inserted = await service
      .from('users')
      .insert({ id: ownerId, ...profile })
      .select('id, email, display_name, role, created_at, disabled_at')
      .single();
    if (inserted.error) {
      await service.auth.admin.deleteUser(ownerId);
      return json({ error: inserted.error.message }, 400);
    }
    user = inserted.data;
  }

  return json({ user, temporaryPassword: password });
});
