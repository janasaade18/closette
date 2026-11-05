import { FootSide } from './dto/create-scan.dto';
import { FootCaptureView } from './constants/capture-guides';

export type ScanStatus = 'capturing' | 'processing' | 'ready' | 'failed';

export type ReconstructionStatus =
  'idle' | 'queued' | 'running' | 'needs_colmap' | 'ready' | 'failed';

export type CameraPose = {
  rotation?: number[];
  translation?: number[];
};

export type FootFrame = {
  id: string;
  index: number;
  view: FootCaptureView;
  storagePath: string;
  url: string;
  accepted: boolean;
  sharpness?: number;
  footVisible?: boolean;
  footAreaRatio?: number;
  pose?: CameraPose;
  capturedAt?: string;
};

export type FootReconstruction = {
  status: ReconstructionStatus;
  glbUrl: string | null;
  objUrl: string | null;
  message?: string;
  workDir?: string;
};

export type FootScan = {
  id: string;
  profileId: string;
  footSide: FootSide;
  status: ScanStatus;
  device: {
    brand?: string;
    model?: string;
    os?: string;
  } | null;
  cameraIntrinsics: {
    fx?: number;
    fy?: number;
    cx?: number;
    cy?: number;
    width?: number;
    height?: number;
  } | null;
  scaleReference: {
    /** e.g. device_ar — never a physical mat or ruler */
    type?: string;
    metersPerUnit?: number;
    confidence?: number;
  } | null;
  frames: FootFrame[];
  reconstruction: FootReconstruction;
  error: string | null;
  createdAt?: string;
};
