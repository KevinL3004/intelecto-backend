import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { entradaSegura } from './common/validation/entrada';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const produccion = process.env.NODE_ENV === 'production';
  const swagger = !produccion || process.env.SWAGGER === 'true';

  // Render está detrás de UN proxy: req.ip toma la IP real solo de ese salto.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // La API solo devuelve JSON o archivos: no necesita cargar nada. (Swagger, en desarrollo, sí.)
      contentSecurityPolicy: swagger
        ? undefined
        : {
            useDefaults: false,
            directives: { 'default-src': ["'none'"], 'frame-ancestors': ["'none'"] },
          },
      strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  // Las respuestas llevan datos personales y financieros: no se guardan en cachés.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Límite de tamaño de las peticiones (evita agotar memoria con cuerpos enormes).
  app.useBodyParser('json', { limit: '200kb' });
  app.useBodyParser('urlencoded', { limit: '50kb', extended: false });
  // Primera barrera de validación (bytes de control, números irrepresentables, anidamiento, prototipos).
  app.use(entradaSegura);

  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? '').split(',').map((o) => o.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    exposedHeaders: ['Content-Disposition'],
    credentials: false,
    maxAge: 600,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  if (swagger) {
    const doc = new DocumentBuilder()
      .setTitle('SVI — API Sistema de Ventas Intelecto')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`API lista en el puerto ${port} (prefijo /api/v1)`, 'Bootstrap');
}
bootstrap();
