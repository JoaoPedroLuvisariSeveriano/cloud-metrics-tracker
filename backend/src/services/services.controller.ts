import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ServiceListResponseDto,
  ServiceResponseDto,
} from './dto/service-response.dto';
import { ServicesService } from './services.service';

/** Rotas públicas (dashboard). Sem cálculos: apenas delega ao ServicesService. */
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  findAll(): Promise<ServiceListResponseDto> {
    return this.servicesService.findAll();
  }

  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ServiceResponseDto> {
    return this.servicesService.findOne(id);
  }
}
