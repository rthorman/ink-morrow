'use strict';

const Busboy = require('busboy');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('node:crypto');

const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function uploadError(message, code = 'INVALID_IMAGE_UPLOAD', statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function receiveImageUpload(req, stagingDir, { maxBytes = DEFAULT_MAX_IMAGE_BYTES } = {}) {
  fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
  const uploadPath = path.join(stagingDir, `${randomUUID()}.upload`);
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: maxBytes, fields: 8, fieldSize: 5000, parts: 9 },
      });
    } catch {
      reject(uploadError('Image upload must use multipart form data with one "image" file.'));
      return;
    }

    const fields = {};
    let fileInfo = null;
    let fileDone = null;
    let fileFailure = null;
    let settled = false;

    const cleanup = () => {
      try { fs.unlinkSync(uploadPath); } catch { /* not created or already removed */ }
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error.statusCode ? error : uploadError(error.message || 'Could not receive the image upload.'));
    };

    parser.on('field', (name, value) => {
      if (Object.prototype.hasOwnProperty.call(fields, name)) return;
      fields[name] = value;
    });
    parser.on('file', (name, stream, info) => {
      if (name !== 'image' || fileInfo) {
        stream.resume();
        fail(uploadError('The uploaded file field must be named "image" and appear once.'));
        return;
      }
      fileInfo = {
        filename: typeof info.filename === 'string' ? info.filename.slice(0, 500) : '',
        mediaType: typeof info.mimeType === 'string' ? info.mimeType.toLowerCase() : '',
      };
      fileDone = new Promise((resolveFile) => {
        const output = fs.createWriteStream(uploadPath, { flags: 'wx', mode: 0o600 });
        let completed = false;
        const done = () => {
          if (completed) return;
          completed = true;
          resolveFile();
        };
        stream.on('limit', () => {
          fileFailure = uploadError(
            `Image exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB upload limit.`,
            'IMAGE_TOO_LARGE',
            413
          );
          stream.unpipe(output);
          output.destroy();
          stream.resume();
          done();
        });
        stream.on('error', (error) => { fileFailure ||= error; done(); });
        output.on('error', (error) => { fileFailure ||= error; stream.resume(); done(); });
        output.on('finish', done);
        stream.pipe(output);
      });
    });
    parser.on('filesLimit', () => fail(uploadError('Upload exactly one image file.')));
    parser.on('fieldsLimit', () => fail(uploadError('The image upload contains too many fields.')));
    parser.on('partsLimit', () => fail(uploadError('The image upload contains too many multipart sections.')));
    parser.on('error', fail);
    req.on('aborted', () => fail(uploadError('The image upload was interrupted.', 'UPLOAD_INTERRUPTED')));
    parser.on('finish', async () => {
      if (settled) return;
      try {
        if (!fileInfo || !fileDone) throw uploadError('Upload one image in the "image" field.');
        await fileDone;
        if (fileFailure) throw fileFailure;
        const stat = fs.statSync(uploadPath);
        if (!stat.isFile() || stat.size === 0) throw uploadError('The uploaded image is empty.');
        settled = true;
        resolve({ path: uploadPath, size: stat.size, fields, ...fileInfo });
      } catch (error) {
        fail(error);
      }
    });
    req.pipe(parser);
  });
}

module.exports = { receiveImageUpload, DEFAULT_MAX_IMAGE_BYTES, uploadError };
