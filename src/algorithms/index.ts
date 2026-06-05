import { Algorithm } from '../types';
import { RateLimitAlgorithm } from './base';
import { FixedWindow } from './fixedWindow';
import { SlidingWindowCounter } from './slidingWindowCounter';
import { SlidingWindowLog } from './slidingWindowLog';
import { TokenBucket } from './tokenBucket';

export { FixedWindow } from './fixedWindow';
export { SlidingWindowCounter } from './slidingWindowCounter';
export { SlidingWindowLog } from './slidingWindowLog';
export { TokenBucket } from './tokenBucket';
export type { RateLimitAlgorithm } from './base';

/** Singleton registry — algorithms are stateless so one instance is enough. */
export const algorithmRegistry: Record<Algorithm, RateLimitAlgorithm> = {
  'fixed-window': new FixedWindow(),
  'sliding-window-counter': new SlidingWindowCounter(),
  'sliding-window-log': new SlidingWindowLog(),
  'token-bucket': new TokenBucket(),
};
