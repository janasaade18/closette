import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FootReconstruction, FootScan } from './foot-model.types';

@Injectable()
export class ReconstructionService {
  private readonly logger = new Logger(ReconstructionService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Server-side 3D pipeline. The phone never reconstructs.
   * Worker later runs: segmentation → poses → COLMAP / MVS → foot.glb
   */
  async enqueue(scan: FootScan): Promise<FootReconstruction> {
    const workerUrl = this.configService.get<string>(
      'RECONSTRUCTION_WORKER_URL',
    );

    const pending: FootReconstruction = {
      status: 'queued',
      glbUrl: null,
      objUrl: null,
      message: workerUrl
        ? 'Queued for the reconstruction worker'
        : 'Frames stored. Start the Python worker and set RECONSTRUCTION_WORKER_URL to run photogrammetry.',
    };

    if (!workerUrl) {
      return { ...pending, status: 'needs_colmap' };
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

      const status =
        result.status === 'ready' || result.status === 'failed'
          ? result.status
          : 'needs_colmap';

      return {
        status,
        glbUrl: result.glb_url ?? null,
        objUrl: result.obj_url ?? null,
        workDir: result.work_dir,
        message:
          result.message ?? 'Worker prepared the scan for photogrammetry',
      };
    } catch (error) {
      this.logger.warn(
        `Reconstruction worker unavailable: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return {
        status: 'needs_colmap',
        glbUrl: null,
        objUrl: null,
        message:
          'Could not reach the Python worker. Frames are saved; run reconstruction later.',
      };
    }
  }
}
