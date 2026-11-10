import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Shoe } from './shoe.types';

type CatalogFile = {
  shoes: Array<{
    slug: string;
    name: string;
    category: Shoe['category'];
    brand: string;
    meshFile: string;
    meshFormat: string;
    sizes: Array<{
      label: string;
      lengthMm: number;
      forefootWidthMm?: number;
      heelWidthMm?: number;
    }>;
  }>;
};

/**
 * Local stand-in catalog from tools/shoes/isaac/demo_catalog.json
 * used until the Supabase shoe tables are migrated / seeded.
 */
@Injectable()
export class FileShoeCatalog implements OnModuleInit {
  private shoes: Shoe[] = [];

  onModuleInit() {
    this.reload();
  }

  reload() {
    // Nest cwd is closette/backend → repo tools live at ../../tools
    const candidates = [
      join(
        process.cwd(),
        '..',
        '..',
        'tools',
        'shoes',
        'isaac',
        'demo_catalog.json',
      ),
      join(process.cwd(), 'tools', 'shoes', 'isaac', 'demo_catalog.json'),
    ];

    const path = candidates.find((candidate) => existsSync(candidate));
    if (!path) {
      this.shoes = [];
      return;
    }

    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CatalogFile;
    const brandId = randomUUID();

    this.shoes = parsed.shoes.map((entry) => ({
      id: randomUUID(),
      slug: entry.slug,
      name: entry.name,
      category: entry.category,
      listed: true,
      brand: {
        id: brandId,
        slug: 'closette-demo-atelier',
        name: entry.brand,
        isDemo: true,
      },
      meshUrl: null,
      meshFormat: entry.meshFormat,
      meshLocalFile: `isaac/${entry.meshFile}`,
      thumbnailUrl: null,
      sizes: entry.sizes.map((size) => ({
        id: randomUUID(),
        label: size.label,
        lengthMm: size.lengthMm,
        forefootWidthMm: size.forefootWidthMm ?? null,
        heelWidthMm: size.heelWidthMm ?? null,
      })),
    }));
  }

  listListed(): Shoe[] {
    return this.shoes.filter((shoe) => shoe.listed);
  }

  findByIdOrSlug(idOrSlug: string): Shoe {
    const shoe = this.shoes.find(
      (item) => item.id === idOrSlug || item.slug === idOrSlug,
    );
    if (!shoe) {
      throw new NotFoundException('Shoe not found');
    }
    return shoe;
  }
}
