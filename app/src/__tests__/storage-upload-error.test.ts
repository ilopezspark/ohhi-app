/**
 * `storage/uploadError.ts`: sorting an upload failure into the few causes the
 * person may be told about, and the dev-only log that names the real one.
 *
 * The shapes below are what storage-js 2.116 actually rejects with
 * (`StorageApiError(message, status, statusCode, namespace, code)`), and the
 * `unsupported` case is the exact refusal the hosted storage logs recorded
 * for the phone's chat photo uploads on 29 September 2026.
 */

jest.mock('expo-file-system', () => ({ File: jest.fn() }));

import { UnknownError, mapSupabaseError } from '../api/errors';
import { UploadTooLargeError } from '../storage/readUpload';
import {
  CHAT_MEDIA_FAILURE_COPY,
  classifyUploadFailure,
  describeUploadError,
  logUploadFailure,
} from '../storage/uploadError';

function storageApiError(message: string, status: number, statusCode: string, code?: string) {
  return Object.assign(new Error(message), { name: 'StorageApiError', status, statusCode, code });
}

describe('classifyUploadFailure', () => {
  it('reads an unsupported type through the UnknownError wrapper the api layer adds', () => {
    const raw = storageApiError('mime type text/plain is not supported', 400, '415', 'InvalidMimeType');
    const wrapped = mapSupabaseError(raw);
    expect(wrapped).toBeInstanceOf(UnknownError);
    expect(classifyUploadFailure(wrapped)).toBe('unsupported');
  });

  it('treats a server size refusal and our own size gate as too large', () => {
    expect(classifyUploadFailure(storageApiError('The object exceeded the maximum allowed size', 400, '413'))).toBe(
      'too_large'
    );
    expect(classifyUploadFailure(new UploadTooLargeError(10, 5))).toBe('too_large');
  });

  it('keeps a policy refusal, a duplicate and a network failure generic (decision 24)', () => {
    expect(classifyUploadFailure(mapSupabaseError(storageApiError('new row violates row-level security policy', 400, '403')))).toBe(
      'other'
    );
    expect(classifyUploadFailure(storageApiError('The resource already exists', 400, '409', 'Duplicate'))).toBe('other');
    expect(classifyUploadFailure(new TypeError('Network request failed'))).toBe('other');
    expect(classifyUploadFailure(undefined)).toBe('other');
  });

  it('has lowercase copy for every reason, and none of it is server text', () => {
    for (const copy of Object.values(CHAT_MEDIA_FAILURE_COPY)) {
      expect(copy).toBe(copy.toLowerCase());
      expect(copy).not.toMatch(/mime|policy|row-level|415|413|403/i);
    }
  });
});

describe('describeUploadError / logUploadFailure', () => {
  it('describes the innermost error', () => {
    const wrapped = mapSupabaseError(storageApiError('mime type text/plain is not supported', 400, '415', 'InvalidMimeType'));
    expect(describeUploadError(wrapped)).toEqual({
      name: 'StorageApiError',
      status: 400,
      statusCode: '415',
      code: 'InvalidMimeType',
      message: 'mime type text/plain is not supported',
    });
  });

  it('logs the step and the underlying error in development', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logUploadFailure(
      { what: 'chat media', step: 'upload', bucket: 'chat-media', path: 'c/m.jpg' },
      storageApiError('mime type text/plain is not supported', 400, '415')
    );
    expect(warn).toHaveBeenCalledWith(
      '[upload] chat media failed at upload',
      expect.objectContaining({ bucket: 'chat-media', path: 'c/m.jpg', reason: 'unsupported', statusCode: '415', status: 400 })
    );
    warn.mockRestore();
  });

  it('stays silent outside development', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const g = globalThis as { __DEV__?: boolean };
    const previous = g.__DEV__;
    g.__DEV__ = false;
    try {
      logUploadFailure({ what: 'chat media', step: 'upload' }, new Error('x'));
    } finally {
      g.__DEV__ = previous;
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
