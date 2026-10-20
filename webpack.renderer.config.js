module.exports = {
  module: {
    rules: [
      { test: /\.tsx?$/, exclude: /node_modules/, use: { loader: 'ts-loader', options: { transpileOnly: true } } },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
      { test: /\.png$/i, type: 'asset/inline' },
    ],
  },
  resolve: { extensions: ['.js', '.ts', '.tsx', '.json'] },
  devtool: 'source-map',
};
