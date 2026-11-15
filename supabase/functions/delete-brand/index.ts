import { json, optionsResponse, requireAdmin } from '../_shared/requireAdmin.ts';

Deno.serve(async (req) => {
  const options = optionsResponse(req);
  if (options) return options;

  const gate = await requireAdmin(req);
  if ('error' in gate) return gate.error;
  const { service } = gate;

  const body = await req.json().catch(() => null);
  const brandId = String(body?.brandId ?? '');
  const active = Boolean(body?.active);
  if (!brandId) return json({ error: 'Choose a brand.' }, 400);

  const { data, error } = await service
    .from('brands')
    .update({ is_active: active })
    .eq('id', brandId)
    .select('*')
    .maybeSingle();
  if (error) return json({ error: error.message }, 400);
  if (!data) return json({ error: 'Brand not found.' }, 404);

  return json({ brand: data });
});
