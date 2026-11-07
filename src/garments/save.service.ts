import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { readFile, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { SupabaseService } from '../supabase/supabase.service';
import { SaveGarmentDto } from './dto/save-garment.dto';
import { MlRunnerService } from './ml-runner.service';

const GARMENT_ROOT = join(process.cwd(), 'ml', 'garment');
const TIMEOUT_MS = 900_000;

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
  cutout_path?: string | null;
  model_version?: string;
  type_model_version?: string;
};

@Injectable()
export class SaveGarmentService {
  constructor(
    private readonly mlRunner: MlRunnerService,
    private readonly supabase: SupabaseService,
  ) {}

  async save(
    file: Express.Multer.File | undefined,
    dto: SaveGarmentDto,
  ): Promise<Record<string, unknown>> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Upload a garment photo as file');
    }
    const extension = IMAGE_EXTENSIONS[file.mimetype];
    if (!extension) {
      throw new BadRequestException('Photo must be jpeg, png, or webp');
    }
    if (!dto.profileId) {
      throw new BadRequestException('profileId is required');
    }

    const directory = await mkdtemp(join(tmpdir(), 'closette-garment-save-'));
    const imagePath = join(directory, `photo${extension}`);
    const cutoutPath = join(directory, 'cutout.png');
    try {
      await writeFile(imagePath, file.buffer);
      const args = [
        '-m',
        'quality.cli',
        imagePath,
        '--mode',
        'prepare',
        '--cutout-out',
        cutoutPath,
      ];
      if (dto.k != null) {
        args.push('--k', String(dto.k));
      }
      const stdout = await this.mlRunner.runPython(
        args,
        GARMENT_ROOT,
        TIMEOUT_MS,
        'Garment save prep timed out',
      );
      const prepared = this.parse(stdout);

      if (prepared.status === 'rejected' || prepared.lighting?.ok === false) {
        throw new UnprocessableEntityException({
          message: 'Lighting is not good enough to save this garment',
          lighting: prepared.lighting,
        });
      }
      if (prepared.status !== 'success' || !prepared.garments?.length) {
        throw new UnprocessableEntityException({
          message: prepared.reason || 'No garment found to save',
          status: prepared.status,
          lighting: prepared.lighting,
        });
      }
      if (!prepared.cutout_path) {
        throw new InternalServerErrorException('Cutout was not produced');
      }

      const garment = prepared.garments[0];
      const cutoutBuffer = await readFile(prepared.cutout_path);
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
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private parse(stdout: string): PreparePayload {
    try {
      return JSON.parse(stdout) as PreparePayload;
    } catch {
      throw new InternalServerErrorException('Save prep returned invalid JSON');
    }
  }
}
