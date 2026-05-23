const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Redirect node crypto to our local dummy shim
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  crypto: require.resolve("./src/services/crypto-shim.js"),
};

module.exports = config;
