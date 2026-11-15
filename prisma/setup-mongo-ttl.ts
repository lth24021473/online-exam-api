import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function setupMongoTtl(client: PrismaClient = prisma): Promise<void> {
  try {
    let existingIndexes: Array<{
      name: string;
      key: Record<string, number>;
      expireAfterSeconds?: number;
    }> = [];

    try {
      const listResult: any = await client.$runCommandRaw({
        listIndexes: 'RevokedToken',
      });
      existingIndexes = listResult?.cursor?.firstBatch || [];
    } catch (error: any) {
      if (error?.code !== 26 && !error?.message?.includes('ns does not exist')) {
        console.warn('Could not list indexes on RevokedToken:', error?.message || error);
      }
    }

    const conflictingIndex = existingIndexes.find(
      (idx) =>
        idx.key?.expiresAt === 1 &&
        (idx.name !== 'expiresAt_ttl_idx' || idx.expireAfterSeconds !== 0),
    );

    if (conflictingIndex) {
      console.log(`Dropping conflicting index: ${conflictingIndex.name}...`);
      await client.$runCommandRaw({
        dropIndexes: 'RevokedToken',
        index: conflictingIndex.name,
      });
    }

    const ttlIndexExists = existingIndexes.some(
      (idx) => idx.name === 'expiresAt_ttl_idx' && idx.expireAfterSeconds === 0,
    );

    if (!ttlIndexExists || conflictingIndex) {
      console.log('Creating TTL index expiresAt_ttl_idx on RevokedToken...');
      await client.$runCommandRaw({
        createIndexes: 'RevokedToken',
        indexes: [
          {
            key: { expiresAt: 1 },
            name: 'expiresAt_ttl_idx',
            expireAfterSeconds: 0,
          },
        ],
      });
      console.log('MongoDB TTL Index (expiresAt_ttl_idx) created successfully.');
    } else {
      console.log('MongoDB TTL Index (expiresAt_ttl_idx) already configured.');
    }
  } catch (error) {
    console.error('Failed to setup MongoDB TTL index:', error);
    throw error;
  }
}

if (process.argv[1]?.includes('setup-mongo-ttl')) {
  setupMongoTtl()
    .catch(() => {
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
