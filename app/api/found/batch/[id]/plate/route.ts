import { randomUUID } from 'node:crypto';
import { ApiError, apiRoute, assertSiteActive, enforceRateLimit } from '@/lib/api/route';
import { MAX_CROP_UPLOAD_BYTES, MAX_PLATES_PER_BATCH } from '@/lib/config/app';
import { DbError } from '@/lib/db/errors';
import { addFoundPlate, checkUploadToken } from '@/lib/db/posting';
import { cropPath, removeCrops, uploadCrop } from '@/lib/db/storage';
import { CropError, processCrop } from '@/lib/images/crop';
import { logError } from '@/lib/log';
import { matchNewPost } from '@/lib/matching/run';
import { buildPlateRecord } from '@/lib/plate/canonical';
import { sha256Hex, TOKEN_PATTERN } from '@/lib/security/tokens';
import { foundPlateSchema } from '@/lib/validation/schemas';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Add one plate (crop image + confirmed reading) to a found batch.
 * multipart/form-data: `data` (JSON, foundPlateSchema) and `crop` (image file).
 * Header `x-upload-token`: the token returned when the batch was opened.
 */
export const POST = apiRoute<{ id: string }>(
  'api/found/plate',
  async (request, { ipHash, params }) => {
    await assertSiteActive();
    const batchId = params.id;
    const uploadToken = request.headers.get('x-upload-token') ?? '';
    if (!UUID.test(batchId) || !TOKEN_PATTERN.test(uploadToken)) {
      throw new ApiError('upload_token_invalid', 403);
    }
    await enforceRateLimit('found:plate', ipHash);

    const tokenHash = sha256Hex(uploadToken);
    if (!(await checkUploadToken(batchId, tokenHash)))
      throw new ApiError('upload_token_invalid', 403);

    if (Number(request.headers.get('content-length') ?? 0) > MAX_CROP_UPLOAD_BYTES + 64 * 1024) {
      throw new ApiError('too_large', 413);
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ApiError('bad_form', 400);
    }
    const crop = form.get('crop');
    const data = form.get('data');
    if (!(crop instanceof File) || typeof data !== 'string') throw new ApiError('bad_form', 400);
    if (crop.size === 0 || crop.size > MAX_CROP_UPLOAD_BYTES) throw new ApiError('too_large', 413);

    let parsedData: unknown;
    try {
      parsedData = JSON.parse(data);
    } catch {
      throw new ApiError('bad_json', 400);
    }
    const body = foundPlateSchema.parse(parsedData);

    let webp: Buffer;
    try {
      webp = await processCrop(Buffer.from(await crop.arrayBuffer()));
    } catch (err) {
      if (err instanceof CropError) throw new ApiError(err.reason, 422);
      throw err;
    }

    const record = buildPlateRecord(body.plate);
    const postId = randomUUID();
    const path = cropPath(batchId, postId);
    // Plates the finder confirmed despite the plate-on-vehicle warning stay hidden until an
    // admin reviews them (spec §7.4).
    const status = body.vehicleWarning ? 'needs_review' : 'active';

    await uploadCrop(path, webp);
    try {
      await addFoundPlate({
        batchId,
        uploadTokenHash: tokenHash,
        postId,
        record,
        cropPath: path,
        status,
        reviewReason: body.vehicleWarning ? ['vehicle_check'] : [],
        ocrMinConfidence: body.ocrMinConfidence ?? null,
        maxPlates: MAX_PLATES_PER_BATCH,
      });
    } catch (err) {
      await removeCrops([path]);
      if (err instanceof DbError && err.reason === 'batch_full')
        throw new ApiError('batch_full', 409);
      if (err instanceof DbError && err.reason === 'upload_token_invalid') {
        throw new ApiError('upload_token_invalid', 403);
      }
      throw err;
    }

    let matches: { matchId: string; kind: string }[] = [];
    if (status === 'active') {
      try {
        matches = (await matchNewPost({ id: postId, kind: 'found', record })).map((m) => ({
          matchId: m.matchId,
          kind: m.kind,
        }));
      } catch (err) {
        logError('api/found/plate:match', err);
      }
    }

    return Response.json(
      { postId, status, formatStatus: record.validation.status, matches },
      { status: 201, headers: { 'cache-control': 'no-store' } },
    );
  },
);
