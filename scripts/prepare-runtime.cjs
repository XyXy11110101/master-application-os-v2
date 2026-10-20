const fs = require('node:fs');
const path = require('node:path');

module.exports = function prepareRuntime() {
  const project = path.resolve(__dirname, '..');
  const root = path.join(project, 'runtime');
  fs.mkdirSync(path.join(root, 'node_modules', '@napi-rs'), { recursive: true });
  for (const name of ['pdfjs-dist', '@napi-rs/canvas', '@napi-rs/canvas-win32-x64-msvc']) {
    const source = path.join(project, 'node_modules', name);
    const target = name === 'pdfjs-dist' ? path.join(root, name) : path.join(root, 'node_modules', name);
    fs.cpSync(source, target, { recursive: true, force: true });
  }
  // npm can leave optional install scripts disabled. Select the shipped Windows
  // archive helper explicitly during our own build instead of requiring a global setting.
  const vendor = path.join(project, 'node_modules', 'electron-winstaller', 'vendor');
  const sevenZip = path.join(vendor, `7z-${process.arch}.exe`);
  if (process.platform === 'win32' && fs.existsSync(sevenZip)) fs.copyFileSync(sevenZip, path.join(vendor, '7z.exe'));
};
if (require.main === module) module.exports();
