import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ExamsModule } from './exams/exams.module';
import { QuestionsModule } from './exams/questions/questions.module';
import { AttemptsModule } from './attempts/attempts.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    ExamsModule,
    QuestionsModule,
    AttemptsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
