import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseService } from '../supabase/supabase.service';
import { FootSide } from './dto/create-scan.dto';
import { FootScanRepository } from './foot-scan.repository';
import { FootReconstruction, FootScan } from './foot-model.types';
import { ReconstructionService } from './reconstruction.service';
import { ScansService } from './scans.service';

describe('ScansService', () => {
  let service: ScansService;
  let footScans: {
    create: jest.Mock;
    findById: jest.Mock;
    addFrame: jest.Mock;
    setStatus: jest.Mock;
    saveReconstruction: jest.Mock;
  };
  let supabaseService: { uploadFootFrame: jest.Mock };
  let reconstructionService: { enqueue: jest.Mock };
  const scans = new Map<string, FootScan>();

  const savedScan = (overrides: Partial<FootScan> = {}): FootScan => ({
    id: '64b7f2c0-a1b2-41d4-85f6-078978901234',
    profileId: '11111111-1111-4111-8111-111111111111',
    footSide: FootSide.Left,
    status: 'capturing',
    device: null,
    cameraIntrinsics: null,
    scaleReference: { type: 'calibration_mat', markerDistanceMm: 200 },
    frames: [],
    reconstruction: { status: 'idle', glbUrl: null, objUrl: null },
    error: null,
    createdAt: '2026-09-19T00:00:00.000Z',
    ...overrides,
  });

  beforeEach(async () => {
    scans.clear();
    footScans = {
      create: jest.fn((input: { footSide: FootSide }) => {
        const scan = savedScan({ footSide: input.footSide });
        scans.set(scan.id, scan);
        return Promise.resolve(scan);
      }),
      findById: jest.fn((id: string) => Promise.resolve(scans.get(id) ?? null)),
      addFrame: jest.fn((id: string, frame: FootScan['frames'][number]) => {
        const scan = scans.get(id);
        if (!scan) {
          return Promise.resolve(null);
        }
        scan.frames.push({
          id: `frame-${scan.frames.length}`,
          url: 'https://cdn.example/frame.jpg',
          storagePath: 'path.jpg',
          ...frame,
        });
        return Promise.resolve(scan);
      }),
      setStatus: jest.fn((id: string, status: FootScan['status']) => {
        const scan = scans.get(id);
        if (scan) {
          scan.status = status;
        }
        return Promise.resolve(scan);
      }),
      saveReconstruction: jest.fn(
        (id: string, reconstruction: FootReconstruction) => {
          const scan = scans.get(id);
          if (scan) {
            scan.reconstruction = reconstruction;
            scan.status = reconstruction.glbUrl ? 'ready' : 'processing';
          }
          return Promise.resolve(scan);
        },
      ),
    };
    supabaseService = {
      uploadFootFrame: jest
        .fn()
        .mockResolvedValue('https://cdn.example/frame.jpg'),
    };
    reconstructionService = {
      enqueue: jest.fn().mockResolvedValue({
        status: 'needs_colmap',
        glbUrl: null,
        objUrl: null,
        message: 'queued',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScansService,
        { provide: FootScanRepository, useValue: footScans },
        { provide: SupabaseService, useValue: supabaseService },
        { provide: ReconstructionService, useValue: reconstructionService },
      ],
    }).compile();

    service = module.get(ScansService);
  });

  it('returns the Phase 1 capture protocol', () => {
    const guides = service.getGuides();
    expect(guides.startWith).toBe('left');
    expect(guides.minAcceptedFrames).toBe(5);
    expect(guides.outlineFit.colorNotReady).toBe('#E53935');
    expect(guides.outlineFit.colorReady).toBe('#43A047');
    expect(guides.outlineFit.autoCaptureOnReady).toBe(true);
    expect(guides.requiredViews).toEqual([
      'top',
      'front',
      'left',
      'right',
      'heel',
    ]);
  });

  it('creates a one-foot capturing session', async () => {
    const result = await service.create({ footSide: FootSide.Left });

    expect(footScans.create).toHaveBeenCalledWith(
      expect.objectContaining({
        footSide: FootSide.Left,
      }),
    );
    expect(result.status).toBe('capturing');
    expect(result.progress.accepted).toBe(0);
  });

  it('throws when a scan does not exist', async () => {
    await expect(
      service.findOne('64b7f2c0-a1b2-41d4-85f6-078978901234'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('uploads an accepted frame', async () => {
    const scan = savedScan();
    scans.set(scan.id, scan);

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

  it('rejects complete before enough covered frames', async () => {
    const scan = savedScan();
    scans.set(scan.id, scan);

    await expect(service.complete(scan.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('enqueues reconstruction after a full capture', async () => {
    const views = ['top', 'front', 'left', 'right', 'heel'] as const;
    const scan = savedScan({
      frames: Array.from({ length: 5 }, (_, index) => ({
        id: `frame-${index}`,
        index,
        view: views[index],
        storagePath: `${index}.jpg`,
        url: `https://cdn.example/${index}.jpg`,
        accepted: true,
      })),
    });
    scans.set(scan.id, scan);

    const result = await service.complete(scan.id);

    expect(reconstructionService.enqueue).toHaveBeenCalled();
    expect(result.status).toBe('processing');
    expect(result.reconstruction.status).toBe('needs_colmap');
  });
});
