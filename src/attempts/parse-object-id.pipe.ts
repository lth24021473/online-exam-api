import {
  BadRequestException,
  Injectable,
  Optional,
  PipeTransform,
} from '@nestjs/common';

@Injectable()
export class ParseObjectIdPipe
  implements PipeTransform<string | undefined, string | undefined> {
  constructor(@Optional() private readonly options?: { optional?: boolean }) { }

  transform(value: string | undefined) {
    if (value === undefined && this.options?.optional) return undefined;
    if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) {
      throw new BadRequestException('Invalid id');
    }
    return value;
  }
}
