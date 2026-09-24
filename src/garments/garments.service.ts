import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

export type GarmentGroup = {
  id: string;
  types: string[];
};

export type GarmentTaxonomy = {
  version: number;
  task: string;
  groups: GarmentGroup[];
};

@Injectable()
export class GarmentsService {
  private readonly taxonomy: GarmentTaxonomy;

  constructor() {
    const file = join(process.cwd(), 'ml', 'garment', 'taxonomy.json');
    this.taxonomy = JSON.parse(readFileSync(file, 'utf8')) as GarmentTaxonomy;
  }

  getTaxonomy(): GarmentTaxonomy {
    return {
      version: this.taxonomy.version,
      task: this.taxonomy.task,
      groups: this.taxonomy.groups,
    };
  }
}
