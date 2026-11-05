/**
 * Default kubeconfig secret patterns, built into every scan.
 *
 * Same set as `packages/core/patterns/kubeconfig.yaml` (the human-readable
 * default pattern file). `kubeconfig-patterns.test.ts` fails if the two
 * drift apart.
 *
 * All values are synthetic-safe: the tests assemble fake kubeconfigs at
 * runtime, so no secret-looking literal is committed.
 */

import type { CustomSecretPattern } from './secrets.js';

export const KUBECONFIG_PATTERNS: CustomSecretPattern[] = [
  {
    id: 'kubeconfig-blob',
    pattern: 'YXBpVmVyc2lvbjogdjEKa2luZDogQ29uZmln[A-Za-z0-9+/=\\r\\n]{200,}',
  },
  {
    id: 'kubeconfig-client-key-data',
    pattern: '(?<=client-key-data:\\s*["\']?)[A-Za-z0-9+/=_-]{40,}={0,2}',
  },
  {
    id: 'kubeconfig-client-certificate-data',
    pattern: '(?<=client-certificate-data:\\s*["\']?)[A-Za-z0-9+/=_-]{40,}={0,2}',
  },
  {
    id: 'kubeconfig-certificate-authority-data',
    pattern: '(?<=certificate-authority-data:\\s*["\']?)[A-Za-z0-9+/=_-]{40,}={0,2}',
  },
  {
    id: 'kubeconfig-token',
    pattern: '(?<=token:\\s*["\']?)[A-Za-z0-9._\\-+/=]{20,}',
  },
  {
    id: 'kubeconfig-pem-material',
    pattern: 'LS0t[A-Za-z0-9+/=]{40,}',
  },
];
