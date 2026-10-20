import { safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class Credentials {
  constructor(private readonly root: string) { fs.mkdirSync(root, { recursive: true }); }
  private file(workspace: string) { return path.join(this.root, `${crypto.createHash('sha256').update(path.resolve(workspace).toLowerCase()).digest('hex')}.bin`); }
  read(workspace: string): string {
    const file = this.file(workspace);
    if (!fs.existsSync(file)) return '';
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 凭据加密暂不可用，密钥未读取。');
    return safeStorage.decryptString(fs.readFileSync(file));
  }
  has(workspace: string) { return fs.existsSync(this.file(workspace)); }
  write(workspace: string, value: string) {
    const file = this.file(workspace);
    if (!value) { if (fs.existsSync(file)) fs.unlinkSync(file); return; }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 凭据加密暂不可用，密钥没有保存。');
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, safeStorage.encryptString(value), { mode: 0o600 });
    fs.renameSync(temporary, file);
  }
}
