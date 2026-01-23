import { mergeConfig } from 'vitest/config';

import baseConfig from '../../tooling/vitest.config.base';

export default mergeConfig(baseConfig, {
  test: {
    coverage: {
      provider: 'v8'
    }
  }
});
