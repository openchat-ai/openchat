import logger from '../core/logger.js';
/**
 * P2P Node Identity ?ed25519 keypair management
 *
 * Each bridge instance gets a persistent ed25519 keypair.
 * The public key becomes the peer's permanent identity (peerId).
 * All handshake messages are signed to prove identity ownership.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const KEY_DIR = path.join(os.homedir(), '.openchat', 'p2p');
const KEY_FILE = path.join(KEY_DIR, 'ed25519-key.json');

function ensureDir() {
  if (!fs.existsSync(KEY_DIR)) {
    fs.mkdirSync(KEY_DIR, { recursive: true });
  }
}

function loadOrGenerateKeypair() {
  ensureDir();

  // Try loading existing key
  if (fs.existsSync(KEY_FILE)) {
    try {
      const raw = fs.readFileSync(KEY_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (data.privateKey && data.publicKey) {
        return {
          privateKey: Buffer.from(data.privateKey, 'hex'),
          publicKey: Buffer.from(data.publicKey, 'hex'),
        };
      }
    } catch (e) {
      logger.info('[P2P Identity] Failed to load key, generating new one');
    }
  }

  // Generate new ed25519 keypair
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });

  // Save to disk
  const data = {
    publicKey: publicKey.toString('hex'),
    privateKey: privateKey.toString('hex'),
    createdAt: Date.now(),
  };
  fs.writeFileSync(KEY_FILE, JSON.stringify(data, null, 2));

  return { publicKey, privateKey };
}

class NodeIdentity {
  constructor() {
    const keypair = loadOrGenerateKeypair();
    this._publicKey = keypair.publicKey;
    this._privateKey = keypair.privateKey;

    // peerId = first 32 hex chars of public key hash
    const hash = crypto.createHash('sha256').update(this._publicKey).digest('hex');
    this._peerId = hash.substring(0, 32);
  }

  get peerId() {
    return this._peerId;
  }

  get publicKey() {
    return this._publicKey;
  }

  /**
   * Sign arbitrary data with this node's ed25519 key.
   * Returns base64-encoded signature.
   */
  sign(data) {
    const sign = crypto.createSign('sha256');
    sign.update(data);
    return sign.sign(this._privateKey).toString('base64');
  }

  /**
   * Verify a signature against a public key.
   * Returns true if signature is valid.
   */
  static verify(data, signature, publicKey) {
    try {
      const verify = crypto.createVerify('sha256');
      verify.update(data);
      return verify.verify(publicKey, Buffer.from(signature, 'base64'));
    } catch {
      return false;
    }
  }

  /**
   * Create a signed handshake payload.
   */
  createHandshake() {
    const payload = {
      peerId: this._peerId,
      publicKey: this._publicKey.toString('base64'),
      timestamp: Date.now(),
    };
    const signature = this.sign(JSON.stringify(payload));
    return { ...payload, signature };
  }

  /**
   * Verify a handshake payload from a remote peer.
   * Returns { valid, peerId, publicKey } or throws.
   */
  static verifyHandshake(handshake) {
    const { signature, publicKey: pubKeyB64, peerId, timestamp } = handshake;
    if (!signature || !pubKeyB64 || !peerId || !timestamp) {
      return { valid: false, reason: 'missing fields' };
    }

    // Reject timestamps older than 5 minutes
    const age = Date.now() - timestamp;
    if (age > 5 * 60 * 1000 || age < -5 * 60 * 1000) {
      return { valid: false, reason: 'timestamp out of range' };
    }

    const publicKey = Buffer.from(pubKeyB64, 'base64');
    const payload = { peerId, publicKey: pubKeyB64, timestamp };

    const valid = NodeIdentity.verify(JSON.stringify(payload), signature, publicKey);
    if (!valid) {
      return { valid: false, reason: 'signature mismatch' };
    }

    // Verify peerId matches public key hash
    const hash = crypto.createHash('sha256').update(publicKey).digest('hex');
    const expectedPeerId = hash.substring(0, 32);
    if (peerId !== expectedPeerId) {
      return { valid: false, reason: 'peerId does not match public key' };
    }

    return { valid: true, peerId, publicKey };
  }
}

export default NodeIdentity;
