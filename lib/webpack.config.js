// Generated using webpack-cli http://github.com/webpack-cli
const path = require('path');

module.exports = {
    mode: 'development',
    entry: './src/index.js',
    output: {
        path: path.resolve(__dirname, "../build"),
        filename: "lib.js",
        library: {
            name: "bagel-lib",
            type: "window",
        }
    },
    optimization: {
        minimize: false
    },
};
