import { ApiError, apiRoute } from '@/lib/api/route';
import { removeCrops } from '@/lib/db/storage';
import {
  pendingStoragePaths,
  purgeExpiredData,
  recentActivePosts,
  storagePathsDone,
} from '@/lib/db/retention';
import { serverEnv } from '@/lib/env/server';
import { logError } from '@/lib/log';
import { matchNewPost } from '@/lib/matching/run';
import { pruneSubscriptions } from '@/lib/notify';
import { buildPlateRecord } from '@/lib/plate/canonical';
import { isCronAuthorized } from '@/lib/security/cron';

/** Crops removed per Storage API call, and calls per run (the rest waits for tomorrow). */
const STORAGE_BATCH = 100;
const STORAGE_ROUNDS = 10;
/** The matching safety net looks back this far (the job runs daily, so two days overlap). */
const REMATCH_DAYS = 2;
const REMATCH_LIMIT = 200;

/**
 * Daily job (D-089), called by the `plate2home-cleanup` Lambda on an Amazon EventBridge
 * schedule (lambda/cleanup): delete what is past its retention period, remove the deleted
 * posts' crops from S3, re-match recent posts, then unsubscribe expired email alerts (SNS).
 */
export const GET = apiRoute('api/cron/retention', async (request) => {
  const env = serverEnv();
  if (!isCronAuthorized(request.headers.get('authorization'), env.CRON_SECRET)) {
    throw new ApiError('unauthorized', 401);
  }
  if (!env.CRON_ENABLED) {
    return Response.json(
      { skipped: 'cron_disabled' },
      { headers: { 'cache-control': 'no-store' } },
    );
  }

  const purged = await purgeExpiredData(env.ACCESS_LOG_RETENTION_DAYS);

  // A failed removal is retried on later runs (up to 10 times); one bad batch must not stop
  // the database purge above from counting.
  const storage = { removed: 0, failed: 0 };
  try {
    for (let round = 0; round < STORAGE_ROUNDS; round++) {
      const paths = await pendingStoragePaths(STORAGE_BATCH);
      if (paths.length === 0) break;
      const ok = await removeCrops(paths);
      await storagePathsDone(ok ? paths : [], ok ? [] : paths);
      storage[ok ? 'removed' : 'failed'] += paths.length;
      if (!ok || paths.length < STORAGE_BATCH) break;
    }
  } catch (err) {
    logError('api/cron/retention:storage', err);
  }

  // Matching safety net (D-048): re-match recent posts in case matching failed when they
  // were posted. Recording a match twice is a no-op, and only new matches notify.
  const rematch = { posts: 0, newMatches: 0, failed: 0 };
  try {
    const since = new Date(Date.now() - REMATCH_DAYS * 24 * 60 * 60 * 1000);
    for (const post of await recentActivePosts(since, REMATCH_LIMIT)) {
      try {
        const recorded = await matchNewPost({
          id: post.id,
          kind: post.kind,
          record: buildPlateRecord(post.plate),
        });
        rematch.posts += 1;
        rematch.newMatches += recorded.filter((m) => m.isNew).length;
      } catch (err) {
        rematch.failed += 1;
        logError('api/cron/retention:rematch', err);
      }
    }
  } catch (err) {
    logError('api/cron/retention:rematch', err);
  }

  // Expired or removed lost watches stop their SNS email subscriptions.
  const alerts = { kept: 0, failed: false };
  try {
    alerts.kept = await pruneSubscriptions();
  } catch (err) {
    alerts.failed = true;
    logError('api/cron/retention:alerts', err);
  }

  return Response.json(
    { purged, storage, rematch, alerts },
    { headers: { 'cache-control': 'no-store' } },
  );
});
