const path = require('path');

module.exports = {
    entry: {
        background: './background.js',
        popup: './popup.js',
      },
      output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].bundle.js'
      },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env']
          }
        }
      }
    ]
  }
};
