import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { AnalyzeAppearanceDto } from './dto/analyze-appearance.dto';
import { MlRunnerService } from './ml-runner.service';

const SCRIPT_DIR = join(process.cwd(), 'ml', 'garment', 'color_pattern');
const PIPELINE = join(SCRIPT_DIR, 'pipeline.py');
const TIMEOUT_MS = 900_000;

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export type ClassifiedGarment = {
  group: string | null;
  type: string | null;
  confidence: number | null;
  box: number[] | null;
  color: unknown;
  pattern: { primary: string; confidence: number };
  texture: { primary: string; confidence: number };
};

export type AppearanceResult = {
  status: 'success' | 'failed';
  garments: ClassifiedGarment[];
  model_version: string;
  error?: string;
};

@Injectable()
export class AppearanceService {
  constructor(private readonly mlRunner: MlRunnerService) {}

  async analyze(
    file: Express.Multer.File | undefined,
    dto: AnalyzeAppearanceDto,
  ): Promise<AppearanceResult> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Upload a garment photo as file');
    }

    const extension = IMAGE_EXTENSIONS[file.mimetype];
    if (!extension) {
      throw new BadRequestException('Photo must be jpeg, png, or webp');
    }

    const directory = await mkdtemp(join(tmpdir(), 'closette-garment-'));
    const imagePath = join(directory, `photo${extension}`);
    try {
      await writeFile(imagePath, file.buffer);
      const args = [PIPELINE, imagePath];
      if (dto.classification) {
        const classificationPath = join(directory, 'classification.json');
        await writeFile(
          classificationPath,
          JSON.stringify(this.parseClassification(dto.classification)),
        );
        args.push('--classification', classificationPath);
      }
      if (dto.k != null) {
        args.push('--k', String(dto.k));
      }
      const stdout = await this.mlRunner.runPython(
        args,
        SCRIPT_DIR,
        TIMEOUT_MS,
        'Garment appearance timed out',
      );
      return this.parseResult(stdout);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private parseClassification(raw: string): unknown {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('classification must be JSON');
    }
    const isRecord =
      parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
    if (!Array.isArray(parsed) && !isRecord) {
      throw new BadRequestException(
        'classification must be a JSON object or array',
      );
    }
    return parsed;
  }

  private parseResult(stdout: string): AppearanceResult {
    try {
      return JSON.parse(stdout) as AppearanceResult;
    } catch {
      throw new InternalServerErrorException(
        'Appearance pipeline returned invalid JSON',
      );
    }
  }
}
