import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { FootCaptureView } from './constants/capture-guides';
import { FootSide } from './dto/create-scan.dto';
import {
  CameraPose,
  FootFrame,
  FootReconstruction,
  FootScan,
  ReconstructionStatus,
  ScanStatus,
} from './foot-model.types';

type DeviceData = {
  brand?: string;
  model?: string;
  os?: string;
  scaleReference?: FootScan['scaleReference'];
};

type PoseData = CameraPose & {
  index?: number;
  footVisible?: boolean;
  footAreaRatio?: number;
};

type ScanRow = {
  id: string;
  profile_id: string;
  foot_side: FootSide;
  status: ScanStatus;
  device_data: DeviceData | null;
  camera_intrinsics: FootScan['cameraIntrinsics'];
  created_at: string;
  scan_frames: FrameRow[] | null;
  processing_jobs: JobRow[] | null;
  reconstruction_assets: AssetRow[] | null;
};

type FrameRow = {
  id: string;
  capture_view: FootCaptureView;
  storage_path: string;
  pose_data: PoseData | null;
  sharpness: number | null;
  accepted: boolean;
  captured_at: string | null;
};

type JobRow = {
  status: string;
  error_message: string | null;
  created_at: string;
};

type AssetRow = {
  asset_type: string;
  storage_path: string | null;
  file_format: string | null;
  status: string;
  created_at: string;
};

const SCAN_SELECT = `
  id,
  profile_id,
  foot_side,
  status,
  device_data,
  camera_intrinsics,
  created_at,
  scan_frames (
    id,
    capture_view,
    storage_path,
    pose_data,
    sharpness,
    accepted,
    captured_at
  ),
  processing_jobs (
    status,
    error_message,
    created_at
  ),
  reconstruction_assets (
    asset_type,
    storage_path,
    file_format,
    status,
    created_at
  )
`;

@Injectable()
export class FootScanRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  async create(input: {
    footSide: FootSide;
    device?: FootScan['device'];
    cameraIntrinsics?: FootScan['cameraIntrinsics'];
    scaleReference?: FootScan['scaleReference'];
  }): Promise<FootScan> {
    const profileId = await this.createGuestProfile();
    const deviceData: DeviceData = {
      ...(input.device ?? {}),
      scaleReference: input.scaleReference ?? null,
    };

    const inserted = await this.query<{ id: string }>(() =>
      this.client
        .from('foot_scans')
        .insert({
          profile_id: profileId,
          foot_side: input.footSide,
          status: 'capturing',
          device_data: deviceData,
          camera_intrinsics: input.cameraIntrinsics ?? null,
        })
        .select('id')
        .single(),
    );

    return this.getById(inserted.id);
  }

  async findById(id: string): Promise<FootScan | null> {
    const { data, error } = await this.client
      .from('foot_scans')
      .select(SCAN_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        `Failed to load foot scan: ${error.message}`,
      );
    }

    if (!data) {
      return null;
    }

    return this.toScan(data);
  }

  async addFrame(
    scanId: string,
    frame: {
      view: FootCaptureView;
      storagePath: string;
      accepted: boolean;
      sharpness?: number;
      footVisible?: boolean;
      footAreaRatio?: number;
      pose?: CameraPose;
      capturedAt?: string;
      index: number;
    },
  ): Promise<FootScan> {
    const poseData: PoseData = {
      index: frame.index,
      rotation: frame.pose?.rotation,
      translation: frame.pose?.translation,
      footVisible: frame.footVisible,
      footAreaRatio: frame.footAreaRatio,
    };

    await this.execute(() =>
      this.client.from('scan_frames').insert({
        foot_scan_id: scanId,
        capture_view: frame.view,
        storage_path: frame.storagePath,
        pose_data: poseData,
        sharpness: frame.sharpness ?? null,
        accepted: frame.accepted,
        captured_at: frame.capturedAt ?? new Date().toISOString(),
      }),
    );

    return this.getById(scanId);
  }

  async setStatus(scanId: string, status: ScanStatus): Promise<FootScan> {
    await this.execute(() =>
      this.client.from('foot_scans').update({ status }).eq('id', scanId),
    );
    return this.getById(scanId);
  }

  async saveReconstruction(
    scanId: string,
    reconstruction: FootReconstruction,
  ): Promise<FootScan> {
    const jobStatus =
      reconstruction.status === 'ready' ? 'ready' : reconstruction.status;

    await this.execute(() =>
      this.client.from('processing_jobs').insert({
        foot_scan_id: scanId,
        job_type: 'reconstruction',
        status: jobStatus,
        error_message: reconstruction.message ?? null,
      }),
    );

    if (reconstruction.glbUrl) {
      await this.insertAsset(scanId, 'mesh', 'glb', reconstruction.glbUrl);
    }
    if (reconstruction.objUrl) {
      await this.insertAsset(scanId, 'mesh', 'obj', reconstruction.objUrl);
    }

    const scanStatus: ScanStatus = reconstruction.glbUrl
      ? 'ready'
      : 'processing';
    return this.setStatus(scanId, scanStatus);
  }

  private async createGuestProfile(): Promise<string> {
    const row = await this.query<{ id: string }>(() =>
      this.client
        .from('profiles')
        .insert({ role: 'guest', display_name: 'Guest' })
        .select('id')
        .single(),
    );
    return row.id;
  }

  private async insertAsset(
    scanId: string,
    assetType: string,
    fileFormat: string,
    storagePath: string,
  ) {
    await this.execute(() =>
      this.client.from('reconstruction_assets').insert({
        foot_scan_id: scanId,
        asset_type: assetType,
        storage_path: storagePath,
        file_format: fileFormat,
        status: 'ready',
      }),
    );
  }

  private async getById(id: string): Promise<FootScan> {
    const scan = await this.findById(id);
    if (!scan) {
      throw new InternalServerErrorException(
        'Foot scan disappeared after write',
      );
    }
    return scan;
  }

  private get client() {
    return this.supabaseService.getClient();
  }

  private async execute(
    run: () => PromiseLike<{ error: { message: string } | null }>,
  ): Promise<void> {
    const { error } = await run();
    if (error) {
      throw new InternalServerErrorException(error.message);
    }
  }

  private async query<T>(
    run: () => PromiseLike<{
      data: T | null;
      error: { message: string } | null;
    }>,
  ): Promise<T> {
    const { data, error } = await run();
    if (error || data == null) {
      throw new InternalServerErrorException(
        error?.message ?? 'Supabase write returned no row',
      );
    }
    return data;
  }

  private toScan(row: ScanRow): FootScan {
    const device = row.device_data;
    const frames = (row.scan_frames ?? [])
      .map((frame) => this.toFrame(frame))
      .sort((a, b) => a.index - b.index);
    const latestJob = [...(row.processing_jobs ?? [])].sort((a, b) =>
      a.created_at < b.created_at ? 1 : -1,
    )[0];
    const assets = [...(row.reconstruction_assets ?? [])].sort((a, b) =>
      a.created_at < b.created_at ? 1 : -1,
    );
    const glbAsset = assets.find((asset) => asset.file_format === 'glb');
    const objAsset = assets.find((asset) => asset.file_format === 'obj');

    return {
      id: row.id,
      profileId: row.profile_id,
      footSide: row.foot_side,
      status: row.status,
      device: device
        ? {
            brand: device.brand,
            model: device.model,
            os: device.os,
          }
        : null,
      cameraIntrinsics: row.camera_intrinsics,
      scaleReference: device?.scaleReference ?? null,
      frames,
      reconstruction: {
        status: this.reconstructionStatus(
          latestJob?.status,
          glbAsset,
          objAsset,
        ),
        glbUrl: glbAsset?.storage_path ?? null,
        objUrl: objAsset?.storage_path ?? null,
        message: latestJob?.error_message ?? undefined,
      },
      error:
        row.status === 'failed' ? (latestJob?.error_message ?? null) : null,
      createdAt: row.created_at,
    };
  }

  private reconstructionStatus(
    jobStatus: string | undefined,
    glb: AssetRow | undefined,
    obj: AssetRow | undefined,
  ): ReconstructionStatus {
    if (glb?.storage_path || obj?.storage_path) {
      return 'ready';
    }
    if (
      jobStatus === 'queued' ||
      jobStatus === 'running' ||
      jobStatus === 'needs_colmap' ||
      jobStatus === 'ready' ||
      jobStatus === 'failed'
    ) {
      return jobStatus;
    }
    return 'idle';
  }

  private toFrame(row: FrameRow): FootFrame {
    const pose = row.pose_data;
    return {
      id: row.id,
      index: pose?.index ?? 0,
      view: row.capture_view,
      storagePath: row.storage_path,
      url: this.supabaseService.publicFootFrameUrl(row.storage_path),
      accepted: row.accepted,
      sharpness: row.sharpness ?? undefined,
      footVisible: pose?.footVisible,
      footAreaRatio: pose?.footAreaRatio,
      pose:
        pose?.rotation || pose?.translation
          ? { rotation: pose.rotation, translation: pose.translation }
          : undefined,
      capturedAt: row.captured_at ?? undefined,
    };
  }
}
