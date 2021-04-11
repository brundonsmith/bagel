module.exports = {
    mode: 'development',
    entry: './src/index.ts',
    output: {
        path: __dirname,
        filename: "dist.js",
    },
    optimization: {
        minimize: false
    },
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
