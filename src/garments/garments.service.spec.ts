import { GarmentsService } from './garments.service';

describe('GarmentsService', () => {
  const service = new GarmentsService();

  it('returns the garment-type groups', () => {
    const taxonomy = service.getTaxonomy();
    expect(taxonomy.task).toBe('garment-type');
    expect(taxonomy.groups.map((group) => group.id)).toEqual([
      'tops',
      'bottoms',
      'one-piece',
      'outerwear',
      'footwear',
      'accessories',
    ]);
  });

  it('keeps subcategory ids under a single parent', () => {
    const types = service.getTaxonomy().groups.flatMap((group) => group.types);
    expect(types).toEqual(
      expect.arrayContaining([
        't-shirt',
        'jeans',
        'dress',
        'jacket',
        'sneakers',
        'hat',
        'bag',
        'belt',
        'scarf',
      ]),
    );
    expect(types).not.toContain('shoe');
  });
});
