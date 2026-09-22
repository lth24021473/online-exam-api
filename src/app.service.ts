import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getInfo() {
    return { name: 'online-exam-api', status: 'ok' };
  }
}
