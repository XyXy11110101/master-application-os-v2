const fs = require('node:fs');
module.exports = async function capture(application, destination) {
  const png = await application.evaluate(async ({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    contents.setBackgroundThrottling(false);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const image = await contents.capturePage(undefined, { stayHidden: true });
        if (image.isEmpty()) throw new Error('Hidden test window returned an empty capture.');
        return image.toPNG().toString('base64');
      } catch (error) {
        if (attempt === 3) throw error;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
  });
  fs.writeFileSync(destination, Buffer.from(png, 'base64'));
};
