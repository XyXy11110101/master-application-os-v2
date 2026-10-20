const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');

const WINDOWS_FOLDER = 'Application Desk V2-win32-x64';

function portableName(value) {
  const name = value.replaceAll('\\', '/');
  const parts = name.replace(/\/$/, '').split('/');
  if (!name || name.startsWith('/') || parts.some(part => !part || part === '.' || part === '..' || /[:\x00-\x1f]/.test(part) || /[. ]$/.test(part))) {
    throw new Error(`Unsafe ZIP entry: ${JSON.stringify(value)}`);
  }
  return name;
}

function normalizeZip(filename, folder = WINDOWS_FOLDER) {
  if (portableName(folder) !== folder || folder.includes('/')) throw new Error('ZIP root must be one directory name.');
  const archive = new AdmZip(filename);
  const entries = archive.getEntries();
  if (!entries.length) throw new Error('Cannot publish an empty application ZIP.');
  const names = entries.map(entry => portableName(entry.entryName));
  const prefix = `${folder}/`;
  const rooted = names.every(name => name === prefix || name.startsWith(prefix));
  if (!rooted && names.some(name => name === prefix || name.startsWith(prefix))) throw new Error('ZIP mixes rooted and unrooted application paths.');
  const seen = new Map();
  const normalized = names.map(name => rooted ? name : `${prefix}${name}`);
  for (const name of normalized) {
    const key = name.replace(/\/$/, '').normalize('NFC').toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate ZIP destination: ${name}`);
    seen.set(key, name.endsWith('/'));
  }
  for (const name of normalized) {
    const parts = name.replace(/\/$/, '').split('/');
    for (let count = 1; count < parts.length; count++) {
      const ancestor = parts.slice(0, count).join('/').normalize('NFC').toLowerCase();
      if (seen.get(ancestor) === false) throw new Error(`ZIP file is also used as a directory: ${name}`);
    }
  }
  // Renaming entries retains the original compressed payload and file metadata.
  entries.forEach((entry, index) => { entry.entryName = normalized[index]; });
  if (!seen.has(folder.normalize('NFC').toLowerCase())) archive.addFile(prefix, Buffer.alloc(0));
  const bytes = archive.toBuffer();
  const written = new AdmZip(bytes).getEntries();
  if (written.some(entry => entry.rawEntryName.includes(0x5c) || !entry.entryName.startsWith(prefix))) {
    throw new Error('ZIP normalization did not produce portable, rooted names.');
  }
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx' });
    fs.renameSync(temporary, filename);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { path: filename, entries: written.length, folder };
}

function normalizeWindowsResults(results) {
  for (const result of results) {
    if (result.platform !== 'win32' || result.arch !== 'x64') continue;
    for (const filename of result.artifacts) if (path.extname(filename).toLowerCase() === '.zip') normalizeZip(filename);
  }
  return results;
}

module.exports = { WINDOWS_FOLDER, portableName, normalizeZip, normalizeWindowsResults };
