import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { SaveGarmentDto } from './dto/save-garment.dto';

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

type PreparePayload = {
  status: string;
  reason?: string | null;
  lighting?: {
    ok: boolean;
    score: number;
    issues: string[];
    guidance: string;
    metrics?: Record<string, number>;
  };
  garments: Array<{
    group?: string | null;
    type?: string | null;
    category?: string | null;
    subcategory?: string | null;
    confidence?: number | null;
    box?: number[] | null;
    color?: unknown;
    pattern?: unknown;
    texture?: unknown;
  }>;
  cutout_png_base64?: string | null;
  model_version?: string;
  type_model_version?: string;
};

@Injectable()
export class SaveGarmentService {
  constructor(private readonly supabase: SupabaseService) {}

  async save(
    file: Express.Multer.File | undefined,
    dto: SaveGarmentDto,
  ): Promise<Record<string, unknown>> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Upload a garment photo as file');
    }
    if (!IMAGE_EXTENSIONS[file.mimetype]) {
      throw new BadRequestException('Photo must be jpeg, png, or webp');
    }
    if (!dto.profileId) {
      throw new BadRequestException('profileId is required');
    }

    const prepared = await this.prepareViaWarmApi(file, dto.k);
    if (prepared.status !== 'success' || !prepared.garments?.length) {
      throw new UnprocessableEntityException({
        message: prepared.reason || 'No garment found to save',
        status: prepared.status,
        lighting: prepared.lighting,
      });
    }
    if (!prepared.cutout_png_base64) {
      throw new InternalServerErrorException('Cutout was not produced');
    }

    const garment = prepared.garments[0];
    await this.supabase.ensureProfile(dto.profileId);
    const cutoutBuffer = Buffer.from(prepared.cutout_png_base64, 'base64');
    const storagePath = `${dto.profileId}/${randomUUID()}.png`;
    const cutoutUrl = await this.supabase.uploadWardrobeCutout(
      storagePath,
      cutoutBuffer,
    );

    const row = {
      profile_id: dto.profileId,
      category: garment.category ?? garment.group ?? null,
      subcategory: garment.subcategory ?? garment.type ?? null,
      confidence: garment.confidence ?? null,
      color: garment.color ?? null,
      pattern: garment.pattern ?? null,
      texture: garment.texture ?? null,
      bbox: garment.box ?? null,
      cutout_path: storagePath,
      cutout_url: cutoutUrl,
      lighting: prepared.lighting ?? null,
      model_version: prepared.model_version ?? null,
      type_model_version: prepared.type_model_version ?? null,
    };

    const saved = await this.supabase.insertGarment(row);
    return {
      status: 'saved',
      garment: saved,
      lighting: prepared.lighting,
    };
  }

  /** Hit the long-lived garment API so FashionCLIP/SegFormer stay warm. */
  private async prepareViaWarmApi(
    file: Express.Multer.File,
    k?: number,
  ): Promise<PreparePayload> {
    const base =
      process.env.CLOSETTE_GARMENT_URL?.replace(/\/$/, '') ||
      'http://127.0.0.1:8090';
    const form = new FormData();
    const bytes = new Uint8Array(file.buffer);
    form.append(
      'image',
      new Blob([bytes], { type: file.mimetype || 'image/jpeg' }),
      file.originalname || 'photo.jpg',
    );
    const query = k != null ? `?k=${encodeURIComponent(String(k))}` : '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);
    try {
      const response = await fetch(`${base}/v1/garments/prepare${query}`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      const text = await response.text();
      let body: PreparePayload & { error?: string; message?: string };
      try {
        body = JSON.parse(text) as PreparePayload & {
          error?: string;
          message?: string;
        };
      } catch {
        throw new BadGatewayException(
          `Garment prepare returned non-JSON (${response.status})`,
        );
      }
      if (!response.ok) {
        throw new BadGatewayException(
          body.message ??
            body.error ??
            `Garment prepare failed: ${response.status}`,
        );
      }
      return body;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/abort/i.test(message)) {
        throw new ServiceUnavailableException(
          'Garment prepare timed out. Keep the classifier on :8090 running.',
        );
      }
      throw new ServiceUnavailableException(
        `Cannot reach garment API at ${base} (${message}). Start uvicorn on :8090.`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
