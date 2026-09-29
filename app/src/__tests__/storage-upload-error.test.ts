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

  it('logs the step and the full underlying error in development, as plain text (nothing truncated)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const long = `Call to function 'FileSystemFile.bytes' has been rejected.
→ Caused by: Missing 'READ' permission for accessing the file ${'x'.repeat(300)}`;
    logUploadFailure(
      { what: 'chat media', step: 'upload', bucket: 'chat-media', path: 'c/m.jpg' },
      Object.assign(storageApiError(long, 400, '415'), { code: 'ERR_INVALID_PERMISSION' })
    );
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0]![0] as string;
    expect(typeof line).toBe('string');
    expect(line).toContain('[upload] chat media failed at upload:');
    expect(line).toContain('status=400');
    expect(line).toContain('statusCode=415');
    expect(line).toContain('code=ERR_INVALID_PERMISSION');
    expect(line).toContain('object=chat-media/c/m.jpg');
    expect(line).toContain(long);
    warn.mockRestore();
  });

  it('logs a handled best-effort failure quietly (console.log, no LogBox warning)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    logUploadFailure({ what: 'chat video poster', step: 'poster', level: 'info' }, new Error('nope'));
    expect(warn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[upload] chat video poster failed at poster'));
    warn.mockRestore();
    log.mockRestore();
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
