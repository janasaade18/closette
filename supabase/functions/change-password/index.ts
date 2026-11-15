import { json, optionsResponse, requireUser } from '../_shared/requireAdmin.ts';

Deno.serve(async (req) => {
  const options = optionsResponse(req);
  if (options) return options;

  const gate = await requireUser(req);
  if ('error' in gate) return gate.error;
  const { userId, email, service, anon } = gate;

  const body = await req.json().catch(() => null);
  const currentPassword = String(body?.currentPassword ?? '');
  const newPassword = String(body?.newPassword ?? '');
  if (!currentPassword) return json({ error: 'Enter your current password.' }, 400);
  if (newPassword.length < 6) {
    return json({ error: 'Password must be at least 6 characters.' }, 400);
  }
  if (newPassword === currentPassword) {
    return json({ error: 'Choose a different password.' }, 400);
  }

  const { data: checked, error: checkError } = await anon.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (checkError || checked.user?.id !== userId) {
    return json({ error: 'Current password is wrong.' }, 401);
  }

  const { error: updateError } = await service.auth.admin.updateUserById(userId, {
    password: newPassword,
  });
  if (updateError) return json({ error: updateError.message }, 400);

  const { error: flagError } = await service
    .from('users')
    .update({ must_change_password: false })
    .eq('id', userId);
  if (flagError) return json({ error: flagError.message }, 400);

  const { data: next, error: nextError } = await anon.auth.signInWithPassword({
    email,
    password: newPassword,
  });
  if (nextError || !next.session) {
    return json({ error: nextError?.message ?? 'Password saved. Sign in with it.' }, 400);
  }

  return json({
    accessToken: next.session.access_token,
    refreshToken: next.session.refresh_token,
  });
});
