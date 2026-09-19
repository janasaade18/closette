import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SupabaseService } from '../supabase/supabase.service';
import {
  FOOT_CAPTURE_GUIDES,
  MAX_ACCEPTED_FRAMES,
  MIN_ACCEPTED_FRAMES,
  MIN_FRAMES_PER_VIEW,
  REQUIRED_FOOT_VIEWS,
} from './constants/capture-guides';
import { CreateScanDto } from './dto/create-scan.dto';
import { UploadFrameDto } from './dto/upload-frame.dto';
import { ReconstructionService } from './reconstruction.service';
import { Scan, ScanDocument } from './schemas/scan.schema';

@Injectable()
export class ScansService {
  constructor(
    @InjectModel(Scan.name) private readonly scanModel: Model<ScanDocument>,
    private readonly supabaseService: SupabaseService,
    private readonly reconstructionService: ReconstructionService,
  ) {}

  getGuides() {
    return {
      role: 'The mobile app only shows these guides, filters frames, and uploads. All 3D reconstruction runs on the server.',
      oneFootAtATime: true,
      startWith: 'left',
      minAcceptedFrames: MIN_ACCEPTED_FRAMES,
      maxAcceptedFrames: MAX_ACCEPTED_FRAMES,
      minFramesPerView: MIN_FRAMES_PER_VIEW,
      requiredViews: REQUIRED_FOOT_VIEWS,
      guides: FOOT_CAPTURE_GUIDES,
    };
  }

  async create(dto: CreateScanDto) {
    const scan = await this.scanModel.create({
      footSide: dto.footSide,
      device: dto.device,
      cameraIntrinsics: dto.cameraIntrinsics,
      scaleReference: dto.scaleReference ?? {
        type: 'calibration_mat',
        markerDistanceMm: 200,
      },
      status: 'capturing',
      frames: [],
      segmentationMasks: [],
      landmarks: [],
      reconstruction: { status: 'idle', glbUrl: null, objUrl: null },
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
    const url = await this.supabaseService.uploadFootFrame(
      storagePath,
      file.buffer,
      file.mimetype,
    );

    scan.frames.push({
      index,
      view: dto.view,
      storagePath,
      url,
      accepted,
      sharpness: dto.sharpness,
      footVisible: dto.footVisible,
      footAreaRatio: dto.footAreaRatio,
      pose: dto.pose,
      capturedAt: dto.capturedAt ? new Date(dto.capturedAt) : undefined,
      uploadedAt: new Date(),
    });

    await scan.save();
    return this.toResponse(scan);
  }

  async complete(id: string) {
    const scan = await this.getScan(id);

    if (scan.status === 'ready' && scan.reconstruction?.glbUrl) {
      return this.toResponse(scan);
    }

    if (scan.status !== 'capturing' && scan.status !== 'failed') {
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

    scan.status = 'processing';
    scan.error = undefined;
    await scan.save();

    await this.reconstructionService.enqueue(scan);

    if (scan.reconstruction?.glbUrl) {
      scan.status = 'ready';
    }

    await scan.save();
    return this.toResponse(scan);
  }

  private coverage(scan: ScanDocument) {
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
    const scan = await this.scanModel.findById(id);
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

  private toResponse(scan: ScanDocument) {
    const progress = this.coverage(scan);

    return {
      scanId: scan.id,
      device: scan.device ?? null,
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
      cameraIntrinsics: scan.cameraIntrinsics ?? null,
      cameraPoses: scan.frames
        .filter((frame) => frame.pose)
        .map((frame) => ({
          index: frame.index,
          pose: frame.pose,
        })),
      scaleReference: scan.scaleReference ?? null,
      segmentationMasks: scan.segmentationMasks ?? [],
      landmarks: scan.landmarks ?? [],
      reconstruction: scan.reconstruction ?? {
        status: 'idle',
        glbUrl: null,
        objUrl: null,
      },
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
      error: scan.error ?? null,
      createdAt: scan.get('createdAt') as Date | undefined,
      updatedAt: scan.get('updatedAt') as Date | undefined,
    };
  }
}
