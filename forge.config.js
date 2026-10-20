const path = require('node:path');
module.exports = {
  packagerConfig: {
    asar: true,
    executableName: 'ApplicationDesk',
    icon: path.resolve(__dirname, 'assets/icon'),
    appBundleId: 'local.applicationdesk.v2',
    extraResource: [
      path.resolve(__dirname, 'runtime'),
      path.resolve(__dirname, 'assets/icon.png'),
    ],
  },
  rebuildConfig: {},
  hooks: {
    generateAssets: async () => require('./scripts/prepare-runtime.cjs')(),
    postMake: async (_config, results) => require('./scripts/normalize-zip.cjs').normalizeWindowsResults(results),
  },
  makers: [
    { name: '@electron-forge/maker-squirrel', config: { name: 'ApplicationDeskV2', setupExe: 'ApplicationDeskV2-Setup.exe' } },
    { name: '@electron-forge/maker-zip', platforms: ['win32'] },
  ],
  plugins: [{
    name: '@electron-forge/plugin-webpack',
    config: {
      mainConfig: './webpack.main.config.js',
      renderer: {
        config: './webpack.renderer.config.js',
        entryPoints: [{
          html: './src/renderer/index.html',
          js: './src/renderer/index.tsx',
          name: 'main_window',
          preload: { js: './src/main/preload.ts' },
        }],
      },
    },
  }],
};
