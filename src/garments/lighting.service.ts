import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { MlRunnerService } from './ml-runner.service';

const GARMENT_ROOT = join(process.cwd(), 'ml', 'garment');
const TIMEOUT_MS = 60_000;

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export type LightingResult = {
  ok: boolean;
  score: number;
  issues: string[];
  guidance: string;
  metrics?: Record<string, number>;
};

@Injectable()
export class LightingService {
  constructor(private readonly mlRunner: MlRunnerService) {}

  async check(file: Express.Multer.File | undefined): Promise<LightingResult> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Upload a garment photo as file');
    }
    const extension = IMAGE_EXTENSIONS[file.mimetype];
    if (!extension) {
      throw new BadRequestException('Photo must be jpeg, png, or webp');
    }

    const directory = await mkdtemp(join(tmpdir(), 'closette-lighting-'));
    const imagePath = join(directory, `photo${extension}`);
    try {
      await writeFile(imagePath, file.buffer);
      const stdout = await this.mlRunner.runPython(
        ['-m', 'quality.cli', imagePath, '--mode', 'lighting'],
        GARMENT_ROOT,
        TIMEOUT_MS,
        'Garment lighting check timed out',
      );
      return this.parse(stdout);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private parse(stdout: string): LightingResult {
    try {
      const payload = JSON.parse(stdout) as LightingResult;
      if (typeof payload.ok !== 'boolean' || !Array.isArray(payload.issues)) {
        throw new Error('missing fields');
      }
      return payload;
    } catch {
      throw new InternalServerErrorException(
        'Lighting check returned invalid JSON',
      );
    }
  }
}
