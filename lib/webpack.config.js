// Generated using webpack-cli http://github.com/webpack-cli
const path = require('path');

module.exports = {
    mode: 'development',
    entry: './src/index.js',
    output: {
        path: __dirname,
        filename: "dist.js",
        library: {
            name: "bagel-lib",
            type: "this",
        }
    },
    optimization: {
        minimize: false
    },
};
