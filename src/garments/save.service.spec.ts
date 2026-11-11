import { UnprocessableEntityException } from '@nestjs/common';
import { writeFile, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { SaveGarmentService } from './save.service';
import { MlRunnerService } from './ml-runner.service';
import { SupabaseService } from '../supabase/supabase.service';

describe('SaveGarmentService', () => {
  const file = {
    buffer: Buffer.from('photo'),
    mimetype: 'image/jpeg',
  } as Express.Multer.File;

  const mlRunner = new MlRunnerService();
  const supabase = {
    ensureProfile: jest.fn(),
    uploadWardrobeCutout: jest.fn(),
    insertGarment: jest.fn(),
  };
  const service = new SaveGarmentService(
    mlRunner,
    supabase as unknown as SupabaseService,
  );

  beforeEach(() => {
    jest.restoreAllMocks();
    supabase.ensureProfile.mockReset();
    supabase.uploadWardrobeCutout.mockReset();
    supabase.insertGarment.mockReset();
    supabase.ensureProfile.mockResolvedValue(undefined);
  });

  it('rejects when no garment is found and never uploads', async () => {
    jest.spyOn(mlRunner, 'runPython').mockResolvedValue(
      JSON.stringify({
        status: 'unclear',
        reason: 'no_garment',
        lighting: {
          ok: false,
          score: 0.2,
          issues: ['too_dark'],
          guidance: 'dark',
        },
        garments: [],
        cutout_path: null,
      }),
    );

    await expect(
      service.save(file, { profileId: '11111111-1111-1111-1111-111111111111' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(supabase.uploadWardrobeCutout).not.toHaveBeenCalled();
    expect(supabase.insertGarment).not.toHaveBeenCalled();
  });

  it('uploads the cutout even when lighting score is imperfect', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'closette-save-test-'));
    const cutoutPath = join(directory, 'cutout.png');
    await writeFile(cutoutPath, Buffer.from([137, 80, 78, 71]));

    jest.spyOn(mlRunner, 'runPython').mockResolvedValue(
      JSON.stringify({
        status: 'success',
        lighting: {
          ok: false,
          score: 0.55,
          issues: ['highlight_clip'],
          guidance: 'soft spots',
        },
        garments: [
          {
            category: 'tops',
            subcategory: 't-shirt',
            confidence: 0.9,
            box: [1, 2, 3, 4],
            color: { primary: { name: 'navy' } },
            pattern: { primary: 'solid', confidence: 0.8 },
            texture: { primary: 'cotton', confidence: 0.7 },
          },
        ],
        cutout_path: cutoutPath,
        model_version: 'color-pattern-v1',
      }),
    );
    supabase.uploadWardrobeCutout.mockResolvedValue(
      'https://example/cutout.png',
    );
    supabase.insertGarment.mockResolvedValue({
      id: 'garment-1',
      cutout_url: 'https://example/cutout.png',
    });

    const result = await service.save(file, {
      profileId: '11111111-1111-1111-1111-111111111111',
    });

    expect(supabase.ensureProfile).toHaveBeenCalled();
    expect(supabase.uploadWardrobeCutout).toHaveBeenCalled();
    expect(supabase.insertGarment).toHaveBeenCalled();
    expect(result.status).toBe('saved');
  });
});
