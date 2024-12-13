module.exports = {
  webpack: (config, { dev, isServer }) => {
    // Ensure you’re not disabling Hot Module Replacement
    if (dev && !isServer) {
      config.mode = 'development';
      // Additional customizations
    }
    return config;
  },
};
