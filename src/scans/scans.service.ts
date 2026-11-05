import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  FOOT_CAPTURE_GUIDES,
  MAX_ACCEPTED_FRAMES,
  MIN_ACCEPTED_FRAMES,
  MIN_FRAMES_PER_VIEW,
  OUTLINE_FIT,
  REQUIRED_FOOT_VIEWS,
} from './constants/capture-guides';
import { CreateScanDto } from './dto/create-scan.dto';
import { UploadFrameDto } from './dto/upload-frame.dto';
import { FootScanRepository } from './foot-scan.repository';
import { FootScan } from './foot-model.types';
import { ReconstructionService } from './reconstruction.service';

@Injectable()
export class ScansService {
  constructor(
    private readonly footScans: FootScanRepository,
    private readonly supabaseService: SupabaseService,
    private readonly reconstructionService: ReconstructionService,
  ) {}

  getGuides() {
    return {
      role: 'The mobile app shows the outline (cadre), filters frames, and uploads. All 3D reconstruction runs on the server.',
      purpose:
        'Foot geometry in millimeters (markerless device AR scale) so Closette can recommend shoe size and drive AR try-on against brand shoe data. No physical calibration tools.',
      oneFootAtATime: true,
      startWith: 'left',
      scale: {
        mode: 'markerless_device_ar',
        physicalTools: false,
        next: 'Compare foot measurements to shoe inner dimensions for fit, then AR overlay.',
      },
      minAcceptedFrames: MIN_ACCEPTED_FRAMES,
      maxAcceptedFrames: MAX_ACCEPTED_FRAMES,
      minFramesPerView: MIN_FRAMES_PER_VIEW,
      requiredViews: REQUIRED_FOOT_VIEWS,
      outlineFit: OUTLINE_FIT,
      guides: FOOT_CAPTURE_GUIDES,
    };
  }

  async create(dto: CreateScanDto) {
    const scan = await this.footScans.create({
      footSide: dto.footSide,
      device: dto.device ?? null,
      cameraIntrinsics: dto.cameraIntrinsics ?? null,
      scaleReference: dto.scaleReference ?? {
        type: 'device_ar',
      },
    });

    return this.toResponse(scan);
  }

  async findOne(id: string) {
    return this.toResponse(await this.getScan(id));
  }

  async addFrame(id: string, file: Express.Multer.File, dto: UploadFrameDto) {
    const scan = await this.getScan(id);

    if (scan.status !== 'capturing') {
      throw new BadRequestException('This scan is no longer accepting frames');
    }

    if (!file?.buffer?.length) {
      throw new BadRequestException('Image file is required');
    }

    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('File must be an image');
    }

    const accepted = dto.accepted !== false;
    const acceptedCount = scan.frames.filter((frame) => frame.accepted).length;

    if (accepted && acceptedCount >= MAX_ACCEPTED_FRAMES) {
      throw new BadRequestException(
        `Already have ${MAX_ACCEPTED_FRAMES} accepted frames`,
      );
    }

    const extension = this.extensionFor(file);
    const index = scan.frames.length;
    const storagePath = `${scan.id}/${String(index).padStart(4, '0')}-${dto.view}${extension}`;
    await this.supabaseService.uploadFootFrame(
      storagePath,
      file.buffer,
      file.mimetype,
    );

    const updated = await this.footScans.addFrame(id, {
      view: dto.view,
      storagePath,
      accepted,
      sharpness: dto.sharpness,
      footVisible: dto.footVisible,
      footAreaRatio: dto.footAreaRatio,
      pose: dto.pose,
      capturedAt: dto.capturedAt,
      index,
    });

    return this.toResponse(updated);
  }

  async complete(id: string) {
    const scan = await this.getScan(id);
    const hasMesh = Boolean(
      scan.reconstruction.glbUrl || scan.reconstruction.objUrl,
    );

    if (scan.status === 'ready' && hasMesh) {
      return this.toResponse(scan);
    }

    const canRetry =
      scan.reconstruction.status === 'needs_colmap' ||
      scan.reconstruction.status === 'failed';

    if (scan.status !== 'capturing' && scan.status !== 'failed' && !canRetry) {
      return this.toResponse(scan);
    }

    const coverage = this.coverage(scan);
    if (coverage.accepted < MIN_ACCEPTED_FRAMES) {
      throw new BadRequestException(
        `Need at least ${MIN_ACCEPTED_FRAMES} accepted frames, have ${coverage.accepted}`,
      );
    }

    if (coverage.missingViews.length > 0) {
      throw new BadRequestException(
        `Need at least ${MIN_FRAMES_PER_VIEW} frames for each view. Missing: ${coverage.missingViews.join(', ')}`,
      );
    }

    await this.footScans.setStatus(id, 'processing');
    const reconstruction = await this.reconstructionService.enqueue(scan);
    const updated = await this.footScans.saveReconstruction(id, reconstruction);
    return this.toResponse(updated);
  }

  private coverage(scan: FootScan) {
    const acceptedFrames = scan.frames.filter((frame) => frame.accepted);
    const missingViews = REQUIRED_FOOT_VIEWS.filter((view) => {
      const count = acceptedFrames.filter(
        (frame) => frame.view === view,
      ).length;
      return count < MIN_FRAMES_PER_VIEW;
    });

    return {
      accepted: acceptedFrames.length,
      total: scan.frames.length,
      missingViews,
      coverage: REQUIRED_FOOT_VIEWS.map((view) => ({
        view,
        count: acceptedFrames.filter((frame) => frame.view === view).length,
        done:
          acceptedFrames.filter((frame) => frame.view === view).length >=
          MIN_FRAMES_PER_VIEW,
      })),
    };
  }

  private async getScan(id: string) {
    const scan = await this.footScans.findById(id);
    if (!scan) {
      throw new NotFoundException('Scan not found');
    }
    return scan;
  }

  private extensionFor(file: Express.Multer.File) {
    const fromName = file.originalname.match(/\.[a-z0-9]+$/i)?.[0];
    if (fromName) {
      return fromName.toLowerCase();
    }

    const byType: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/heic': '.heic',
      'image/heif': '.heif',
    };

    return byType[file.mimetype] ?? '.jpg';
  }

  private toResponse(scan: FootScan) {
    const progress = this.coverage(scan);

    return {
      scanId: scan.id,
      profileId: scan.profileId,
      device: scan.device,
      footSide: scan.footSide,
      status: scan.status,
      frames: scan.frames.map((frame) => ({
        index: frame.index,
        view: frame.view,
        url: frame.url,
        accepted: frame.accepted,
        sharpness: frame.sharpness,
        footVisible: frame.footVisible,
        footAreaRatio: frame.footAreaRatio,
        pose: frame.pose ?? null,
        capturedAt: frame.capturedAt,
      })),
      cameraIntrinsics: scan.cameraIntrinsics,
      cameraPoses: scan.frames
        .filter((frame) => frame.pose)
        .map((frame) => ({
          index: frame.index,
          pose: frame.pose,
        })),
      scaleReference: scan.scaleReference,
      reconstruction: scan.reconstruction,
      progress: {
        accepted: progress.accepted,
        total: progress.total,
        min: MIN_ACCEPTED_FRAMES,
        max: MAX_ACCEPTED_FRAMES,
        percent: Math.min(
          100,
          Math.round((progress.accepted / MIN_ACCEPTED_FRAMES) * 100),
        ),
        coverage: progress.coverage,
        missingViews: progress.missingViews,
      },
      error: scan.error,
      createdAt: scan.createdAt,
    };
  }
}
