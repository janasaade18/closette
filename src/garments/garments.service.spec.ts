import { GarmentsService } from './garments.service';

describe('GarmentsService', () => {
  const service = new GarmentsService();

  it('returns the garment-type groups', () => {
    const taxonomy = service.getTaxonomy();
    expect(taxonomy.task).toBe('garment-type');
    expect(taxonomy.groups.map((group) => group.id)).toEqual([
      'top',
      'bottom',
      'one-piece',
      'outerwear',
      'footwear',
      'accessories',
    ]);
  });

  it('includes shoe and the accessory types', () => {
    const types = service.getTaxonomy().groups.flatMap((group) => group.types);
    expect(types).toEqual(
      expect.arrayContaining(['shoe', 'hat', 'bag', 'belt', 'scarf']),
    );
  });
});
