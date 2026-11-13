import { json, optionsResponse, requireAdmin } from '../_shared/requireAdmin.ts';

Deno.serve(async (req) => {
  const options = optionsResponse(req);
  if (options) return options;

  const gate = await requireAdmin(req);
  if ('error' in gate) return gate.error;
  const { userId, service } = gate;

  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? '').trim();
  const email = String(body?.email ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');
  const description = String(body?.description ?? '').trim() || null;
  if (!name || name.length > 80) return json({ error: 'Enter a brand name.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Enter a valid login email.' }, 400);
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
    const message = createError?.message ?? 'Could not create the brand login.';
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
  };
  const { data: updated, error: updateError } = await service
    .from('users')
    .update(profile)
    .eq('id', ownerId)
    .select('id');
  if (updateError) {
    await service.auth.admin.deleteUser(ownerId);
    return json({ error: updateError.message }, 400);
  }
  if (!updated?.length) {
    const { error: insertError } = await service.from('users').insert({ id: ownerId, ...profile });
    if (insertError) {
      await service.auth.admin.deleteUser(ownerId);
      return json({ error: insertError.message }, 400);
    }
  }

  const { data: brand, error: brandError } = await service
    .from('brands')
    .insert({
      name,
      description,
      owner_user_id: ownerId,
      created_by: userId,
      is_active: true,
    })
    .select('*')
    .single();
  if (brandError || !brand) {
    await service.auth.admin.deleteUser(ownerId);
    return json({ error: brandError?.message ?? 'Could not create the brand.' }, 400);
  }

  return json({ brand, ownerEmail: email, temporaryPassword: password });
});
