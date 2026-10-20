module.exports = {
  entry: { index: './src/main/index.ts', worker: './src/main/worker.ts' },
  output: { filename: '[name].cjs' },
  module: {
    rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: { loader: 'ts-loader', options: { transpileOnly: true } } }],
  },
  resolve: { extensions: ['.js', '.ts', '.tsx', '.json'] },
  externals: { 'node:sqlite': 'commonjs node:sqlite' },
  devtool: 'source-map',
};
