// Generated using webpack-cli http://github.com/webpack-cli
const path = require('path');

module.exports = {
    mode: 'development',
    entry: './src/index.ts',
    output: {
        path: path.resolve(__dirname, "../build"),
        filename: "compiler.js",
    },
    target: "node",
    plugins: [
        // Add your plugins here
        // Learn more obout plugins from https://webpack.js.org/configuration/plugins/
    ],
    module: {
        rules: [
            {
                test: /\.ts$/,
                loader: 'ts-loader',
                exclude: ['/node_modules/'],
            },
        ],
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
};
