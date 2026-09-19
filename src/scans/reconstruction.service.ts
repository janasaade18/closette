import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScanDocument } from './schemas/scan.schema';

@Injectable()
export class ReconstructionService {
  private readonly logger = new Logger(ReconstructionService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Server-side 3D pipeline. The phone never reconstructs.
   * Worker later runs: segmentation → poses → COLMAP / MVS → foot.glb
   */
  async enqueue(scan: ScanDocument): Promise<void> {
    const workerUrl = this.configService.get<string>(
      'RECONSTRUCTION_WORKER_URL',
    );

    scan.reconstruction = {
      status: 'queued',
      glbUrl: null,
      objUrl: null,
      message: workerUrl
        ? 'Queued for the reconstruction worker'
        : 'Frames stored. Start closette/reconstruction and set RECONSTRUCTION_WORKER_URL to run photogrammetry.',
    };

    if (!workerUrl) {
      scan.reconstruction.status = 'needs_colmap';
      return;
    }

    const payload = {
      scan_id: scan.id,
      foot_side: scan.footSide,
      device: scan.device,
      camera_intrinsics: scan.cameraIntrinsics,
      scale_reference: scan.scaleReference,
      frames: scan.frames
        .filter((frame) => frame.accepted)
        .map((frame) => ({
          index: frame.index,
          view: frame.view,
          url: frame.url,
          sharpness: frame.sharpness,
          pose: frame.pose,
        })),
    };

    try {
      const response = await fetch(
        `${workerUrl.replace(/\/$/, '')}/reconstruct`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        throw new Error(`Worker returned ${response.status}`);
      }

      const result = (await response.json()) as {
        status?: string;
        work_dir?: string;
        glb_url?: string;
        obj_url?: string;
        message?: string;
      };

      scan.reconstruction.status =
        result.status === 'ready' ? 'ready' : 'needs_colmap';
      scan.reconstruction.workDir = result.work_dir;
      scan.reconstruction.glbUrl = result.glb_url ?? null;
      scan.reconstruction.objUrl = result.obj_url ?? null;
      scan.reconstruction.message =
        result.message ?? 'Worker prepared the scan for photogrammetry';
    } catch (error) {
      this.logger.warn(
        `Reconstruction worker unavailable: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      scan.reconstruction.status = 'needs_colmap';
      scan.reconstruction.message =
        'Could not reach the Python worker. Frames are saved; run reconstruction later.';
    }
  }
}
