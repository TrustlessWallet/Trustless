const { withStringsXml } = require('@expo/config-plugins');

const withPinnedDevServerIp = (config) => {
  return withStringsXml(config, (config) => {
    const strings = config.modResults.resources.string ?? [];

    const filtered = strings.filter(
      (s) => s.$.name !== 'react_native_dev_server_ip'
    );

    filtered.push({
      $: { name: 'react_native_dev_server_ip', translatable: 'false' },
      _: 'localhost',
    });

    config.modResults.resources.string = filtered;
    return config;
  });
};

module.exports = withPinnedDevServerIp;