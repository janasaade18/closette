import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { SupabaseService } from '../supabase/supabase.service';
import { FootSide } from './dto/create-scan.dto';
import { ReconstructionService } from './reconstruction.service';
import { Scan } from './schemas/scan.schema';
import { ScansService } from './scans.service';

describe('ScansService', () => {
  let service: ScansService;
  let scanModel: {
    create: jest.Mock;
    findById: jest.Mock;
  };
  let supabaseService: { uploadFootFrame: jest.Mock };
  let reconstructionService: { enqueue: jest.Mock };

  const savedScan = (overrides: Record<string, unknown> = {}) => {
    const scan = {
      id: '64b7f2c0a1b2c3d4e5f60789',
      footSide: FootSide.Left,
      status: 'capturing',
      frames: [] as unknown[],
      reconstruction: { status: 'idle', glbUrl: null, objUrl: null },
      error: undefined,
      save: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(() => new Date('2026-09-19')),
      ...overrides,
    };
    return scan;
  };

  beforeEach(async () => {
    scanModel = {
      create: jest.fn(),
      findById: jest.fn(),
    };
    supabaseService = {
      uploadFootFrame: jest
        .fn()
        .mockResolvedValue('https://cdn.example/frame.jpg'),
    };
    reconstructionService = {
      enqueue: jest
        .fn()
        .mockImplementation((scan: { reconstruction: unknown }) => {
          scan.reconstruction = {
            status: 'needs_colmap',
            glbUrl: null,
            objUrl: null,
            message: 'queued',
          };
          return Promise.resolve();
        }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScansService,
        { provide: getModelToken(Scan.name), useValue: scanModel },
        { provide: SupabaseService, useValue: supabaseService },
        { provide: ReconstructionService, useValue: reconstructionService },
      ],
    }).compile();

    service = module.get(ScansService);
  });

  it('returns the Phase 1 capture protocol', () => {
    const guides = service.getGuides();
    expect(guides.startWith).toBe('left');
    expect(guides.minAcceptedFrames).toBe(30);
    expect(guides.requiredViews).toEqual([
      'top',
      'front',
      'left',
      'right',
      'heel',
    ]);
  });

  it('creates a one-foot capturing session', async () => {
    const created = savedScan();
    scanModel.create.mockResolvedValue(created);

    const result = await service.create({ footSide: FootSide.Left });

    expect(scanModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        footSide: FootSide.Left,
        status: 'capturing',
      }),
    );
    expect(result.status).toBe('capturing');
    expect(result.progress.accepted).toBe(0);
  });

  it('throws when a scan does not exist', async () => {
    scanModel.findById.mockResolvedValue(null);
    await expect(
      service.findOne('64b7f2c0a1b2c3d4e5f60789'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('uploads an accepted frame', async () => {
    const scan = savedScan();
    scanModel.findById.mockResolvedValue(scan);

    const result = await service.addFrame(
      scan.id,
      {
        buffer: Buffer.from('fake-image'),
        mimetype: 'image/jpeg',
        originalname: 'frame.jpg',
      } as Express.Multer.File,
      { view: 'top', accepted: true },
    );

    expect(supabaseService.uploadFootFrame).toHaveBeenCalled();
    expect(scan.frames).toHaveLength(1);
    expect(result.progress.accepted).toBe(1);
  });

  it('rejects complete before 30 covered frames', async () => {
    scanModel.findById.mockResolvedValue(savedScan());

    await expect(
      service.complete('64b7f2c0a1b2c3d4e5f60789'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enqueues reconstruction after a full capture', async () => {
    const views = ['top', 'front', 'left', 'right', 'heel'] as const;
    const frames = Array.from({ length: 30 }, (_, index) => ({
      index,
      view: views[index % 5],
      accepted: true,
    }));
    const scan = savedScan({ frames });
    scanModel.findById.mockResolvedValue(scan);

    const result = await service.complete(scan.id);

    expect(reconstructionService.enqueue).toHaveBeenCalled();
    expect(result.status).toBe('processing');
    expect(result.reconstruction.status).toBe('needs_colmap');
  });
});
