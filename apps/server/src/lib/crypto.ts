import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { config } from '../config.ts';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

export const uuid = () => randomUUID();
export const token = (bytes = 24) => randomBytes(bytes).toString('base64url');

function derive(purpose: string): Buffer {
  return createHash('sha256').update(`${purpose}:${config.secret}`).digest();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(expected, actual);
}

/** AES-256-GCM for BYOK keys and other per-tenant secrets. Never returned to clients. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derive('enc'), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decrypt(blob: string): string {
  const buf = Buffer.from(blob, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', derive('enc'), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

export function hint(secret: string): string {
  return secret.length <= 8 ? '••••' : `${secret.slice(0, 3)}…${secret.slice(-4)}`;
}

const jwtKey = () => new Uint8Array(derive('jwt'));

export async function signJwt(payload: JWTPayload, ttl: string): Promise<string> {
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(ttl).sign(jwtKey());
}

export async function verifyJwt<T extends JWTPayload>(jwt: string): Promise<T | null> {
  try {
    const { payload } = await jwtVerify(jwt, jwtKey(), { algorithms: ['HS256'] });
    return payload as T;
  } catch {
    return null;
  }
}

export function hmacHex(secret: string, body: string | Buffer): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}
