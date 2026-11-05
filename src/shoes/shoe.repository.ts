import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { FileShoeCatalog } from './file-shoe.catalog';
import { Shoe, ShoeCategory, ShoeSize } from './shoe.types';

type BrandRow = {
  id: string;
  slug: string;
  name: string;
  is_demo: boolean;
};

type SizeRow = {
  id: string;
  label: string;
  length_mm: number;
  forefoot_width_mm: number | null;
  heel_width_mm: number | null;
};

type ShoeRow = {
  id: string;
  slug: string;
  name: string;
  category: ShoeCategory;
  listed: boolean;
  mesh_url: string | null;
  mesh_format: string | null;
  mesh_local_file: string | null;
  thumbnail_url: string | null;
  brands: BrandRow | BrandRow[] | null;
  shoe_sizes: SizeRow[] | null;
};

const SHOE_SELECT = `
  id,
  slug,
  name,
  category,
  listed,
  mesh_url,
  mesh_format,
  mesh_local_file,
  thumbnail_url,
  brands (
    id,
    slug,
    name,
    is_demo
  ),
  shoe_sizes (
    id,
    label,
    length_mm,
    forefoot_width_mm,
    heel_width_mm
  )
`;

@Injectable()
export class ShoeRepository {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly fileCatalog: FileShoeCatalog,
  ) {}

  private get client() {
    return this.supabaseService.getClient();
  }

  private isMissingRelation(message: string | undefined) {
    return Boolean(
      message &&
      (/could not find the table/i.test(message) ||
        /schema cache/i.test(message) ||
        /relation .* does not exist/i.test(message)),
    );
  }

  async listListed(): Promise<Shoe[]> {
    const { data, error } = await this.client
      .from('shoes')
      .select(SHOE_SELECT)
      .eq('listed', true)
      .order('name');

    if (error) {
      if (this.isMissingRelation(error.message)) {
        return this.fileCatalog.listListed();
      }
      throw new InternalServerErrorException(error.message);
    }

    return ((data as ShoeRow[] | null) ?? []).map((row) => this.mapShoe(row));
  }

  async findByIdOrSlug(idOrSlug: string): Promise<Shoe> {
    const byId = await this.client
      .from('shoes')
      .select(SHOE_SELECT)
      .eq('id', idOrSlug)
      .maybeSingle();

    if (byId.data) {
      return this.mapShoe(byId.data);
    }

    if (byId.error && this.isMissingRelation(byId.error.message)) {
      return this.fileCatalog.findByIdOrSlug(idOrSlug);
    }

    const bySlug = await this.client
      .from('shoes')
      .select(SHOE_SELECT)
      .eq('slug', idOrSlug)
      .maybeSingle();

    if (bySlug.error) {
      if (this.isMissingRelation(bySlug.error.message)) {
        return this.fileCatalog.findByIdOrSlug(idOrSlug);
      }
      throw new InternalServerErrorException(bySlug.error.message);
    }
    if (!bySlug.data) {
      try {
        return this.fileCatalog.findByIdOrSlug(idOrSlug);
      } catch {
        throw new NotFoundException('Shoe not found');
      }
    }

    return this.mapShoe(bySlug.data);
  }

  async findFootMeasurement(scanId: string): Promise<{
    lengthMm: number;
    forefootWidthMm: number | null;
  } | null> {
    const { data, error } = await this.client
      .from('foot_measurements')
      .select('length_mm, forefoot_width_mm, created_at')
      .eq('foot_scan_id', scanId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (this.isMissingRelation(error.message)) {
        return null;
      }
      throw new InternalServerErrorException(error.message);
    }
    if (!data?.length_mm) {
      return null;
    }

    return {
      lengthMm: Number(data.length_mm),
      forefootWidthMm:
        data.forefoot_width_mm == null ? null : Number(data.forefoot_width_mm),
    };
  }

  private mapShoe(row: ShoeRow): Shoe {
    const brand = Array.isArray(row.brands) ? row.brands[0] : row.brands;
    if (!brand) {
      throw new InternalServerErrorException('Shoe is missing brand');
    }

    const sizes: ShoeSize[] = (row.shoe_sizes ?? [])
      .map((size) => ({
        id: size.id,
        label: size.label,
        lengthMm: Number(size.length_mm),
        forefootWidthMm:
          size.forefoot_width_mm == null
            ? null
            : Number(size.forefoot_width_mm),
        heelWidthMm:
          size.heel_width_mm == null ? null : Number(size.heel_width_mm),
      }))
      .sort((a, b) => a.lengthMm - b.lengthMm);

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: row.category,
      listed: row.listed,
      brand: {
        id: brand.id,
        slug: brand.slug,
        name: brand.name,
        isDemo: brand.is_demo,
      },
      meshUrl: row.mesh_url,
      meshFormat: row.mesh_format,
      meshLocalFile: row.mesh_local_file,
      thumbnailUrl: row.thumbnail_url,
      sizes,
    };
  }
}
