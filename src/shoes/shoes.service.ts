import { BadRequestException, Injectable } from '@nestjs/common';
import { FitShoeDto } from './dto/fit-shoe.dto';
import { ShoeRepository } from './shoe.repository';
import { FitRecommendation, Shoe } from './shoe.types';

@Injectable()
export class ShoesService {
  constructor(private readonly shoes: ShoeRepository) {}

  list() {
    return this.shoes.listListed();
  }

  findOne(idOrSlug: string) {
    return this.shoes.findByIdOrSlug(idOrSlug);
  }

  async tryOn(idOrSlug: string) {
    const shoe = await this.shoes.findByIdOrSlug(idOrSlug);
    return {
      shoeId: shoe.id,
      slug: shoe.slug,
      name: shoe.name,
      category: shoe.category,
      brand: shoe.brand,
      meshUrl: shoe.meshUrl,
      meshFormat: shoe.meshFormat,
      meshLocalFile: shoe.meshLocalFile,
      placement: {
        alignTo: 'foot',
        note: 'Phone AR places this mesh on the scanned foot. Demo meshes are local until uploaded to storage.',
      },
    };
  }

  async fit(idOrSlug: string, dto: FitShoeDto): Promise<FitRecommendation> {
    const shoe = await this.shoes.findByIdOrSlug(idOrSlug);
    const foot = await this.resolveFoot(dto);

    if (shoe.sizes.length === 0) {
      throw new BadRequestException('This shoe has no size run yet');
    }

    const scored = shoe.sizes.map((size) => {
      const lengthDelta = size.lengthMm - foot.lengthMm;
      const widthDelta =
        size.forefootWidthMm != null && foot.forefootWidthMm != null
          ? size.forefootWidthMm - foot.forefootWidthMm
          : 0;
      // Prefer a little room (positive length delta ~2–8mm) over tight fit.
      const lengthPenalty = Math.abs(lengthDelta - 4);
      const widthPenalty = Math.abs(widthDelta) * 0.5;
      const score = lengthPenalty + widthPenalty;
      return { size, lengthDelta, widthDelta, score };
    });

    scored.sort((a, b) => a.score - b.score);
    const best = scored[0];
    const confidence = Math.max(0.35, Math.min(0.98, 1 - best.score / 40));

    return {
      shoeId: shoe.id,
      shoeSlug: shoe.slug,
      recommendedSize: best.size.label,
      confidence: Number(confidence.toFixed(2)),
      lengthDeltaMm: Number(best.lengthDelta.toFixed(1)),
      widthDeltaMm: Number(best.widthDelta.toFixed(1)),
      alternatives: scored.slice(0, 3).map((item) => ({
        label: item.size.label,
        score: Number(item.score.toFixed(2)),
      })),
      foot,
      tryOn: {
        meshUrl: shoe.meshUrl,
        meshFormat: shoe.meshFormat,
        meshLocalFile: shoe.meshLocalFile,
      },
    };
  }

  private async resolveFoot(
    dto: FitShoeDto,
  ): Promise<FitRecommendation['foot']> {
    if (dto.scanId) {
      const measured = await this.shoes.findFootMeasurement(dto.scanId);
      if (measured) {
        return {
          lengthMm: measured.lengthMm,
          forefootWidthMm: measured.forefootWidthMm ?? undefined,
          source: 'scan',
        };
      }
    }

    if (dto.lengthMm == null) {
      throw new BadRequestException(
        'Provide lengthMm for demo fit, or a scanId that already has foot_measurements',
      );
    }

    return {
      lengthMm: dto.lengthMm,
      forefootWidthMm: dto.forefootWidthMm,
      source: 'manual',
    };
  }

  toListItem(shoe: Shoe) {
    return {
      id: shoe.id,
      slug: shoe.slug,
      name: shoe.name,
      category: shoe.category,
      brand: shoe.brand,
      meshUrl: shoe.meshUrl,
      meshFormat: shoe.meshFormat,
      meshLocalFile: shoe.meshLocalFile,
      thumbnailUrl: shoe.thumbnailUrl,
      sizeLabels: shoe.sizes.map((size) => size.label),
    };
  }
}
