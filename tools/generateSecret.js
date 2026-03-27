import crypto from 'crypto';

const size = Number(process.argv[2]) || 32;
const byteLength = Number.isFinite(size) && size >= 16 ? Math.floor(size) : 32;

process.stdout.write(`${crypto.randomBytes(byteLength).toString('base64url')}\n`);
