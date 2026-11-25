import { garmentLabel, sanitizeMuseReply } from './muse-reply.util';

describe('muse-reply.util', () => {
  const wardrobe = [
    {
      id: 'da20213a-2962-4d11-9abc-1234567890ab',
      category: 'tops',
      subcategory: 'sweatshirt',
      colors: { primary: 'grey' },
    },
  ];

  it('builds human labels', () => {
    expect(garmentLabel(wardrobe[0])).toBe('grey sweatshirt');
  });

  it('strips uuids and backticks from replies', () => {
    const raw =
      'Try your grey sweatshirt (`da20213a`) with the black coat (da20213a-2962-4d11-9abc-1234567890ab).';
    const cleaned = sanitizeMuseReply(raw, wardrobe);
    expect(cleaned).not.toMatch(/da20213a/i);
    expect(cleaned).toMatch(/grey sweatshirt/i);
  });
});
