import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  /** Usado pelo healthcheck do docker-compose. */
  @Get('health')
  health(): { status: 'ok'; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
