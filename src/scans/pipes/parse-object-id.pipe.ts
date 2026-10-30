import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

const SCAN_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!SCAN_ID.test(value)) {
      throw new BadRequestException('Invalid scan id');
    }
    return value;
  }
}
