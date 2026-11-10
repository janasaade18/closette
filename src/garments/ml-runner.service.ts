import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { spawn } from 'child_process';

@Injectable()
export class MlRunnerService {
  runPython(
    args: string[],
    cwd: string,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<string> {
    const python = process.env.CLOSETTE_PYTHON || 'python';
    return new Promise((resolve, reject) => {
      const child = spawn(python, args, {
        cwd,
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new GatewayTimeoutException(timeoutMessage));
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(
          new ServiceUnavailableException(
            `Python failed to start: ${error.message}`,
          ),
        );
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          const detail = stderr.trim().split('\n').at(-1) || `exit ${code}`;
          reject(new BadGatewayException(detail));
          return;
        }
        resolve(stdout);
      });
    });
  }
}
