import { EventEmitter } from 'events';
import { logger } from '../config/logger';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  successThreshold: number;
  /** Milliseconds to wait in OPEN state before attempting HALF_OPEN */
  timeout: number;
}

/**
 * Classic three-state circuit breaker wrapping Redis calls.
 *
 * CLOSED  → normal operation; failures increment a counter.
 * OPEN    → fast-fail all calls; after `timeout` ms, moves to HALF_OPEN.
 * HALF_OPEN → probe with real calls; consecutive successes close the circuit,
 *             any failure re-opens it.
 */
export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private nextAttemptTime?: number;

  constructor(private readonly options: CircuitBreakerOptions) {
    super();
  }

  getState(): CircuitState {
    return this.state;
  }

  /** Returns true when all calls should fail fast. */
  isOpen(): boolean {
    if (this.state === CircuitState.OPEN) {
      if (this.nextAttemptTime !== undefined && Date.now() >= this.nextAttemptTime) {
        this.transitionTo(CircuitState.HALF_OPEN);
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.failureCount = 0;
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.options.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
      }
    }
  }

  recordFailure(): void {
    this.successCount = 0;
    this.failureCount++;
    if (this.state === CircuitState.HALF_OPEN || this.failureCount >= this.options.failureThreshold) {
      this.transitionTo(CircuitState.OPEN);
    }
  }

  private transitionTo(state: CircuitState): void {
    const previous = this.state;
    this.state = state;

    if (state === CircuitState.OPEN) {
      this.nextAttemptTime = Date.now() + this.options.timeout;
    } else if (state === CircuitState.CLOSED) {
      this.failureCount = 0;
      this.successCount = 0;
      this.nextAttemptTime = undefined;
    } else if (state === CircuitState.HALF_OPEN) {
      this.successCount = 0;
    }

    if (previous !== state) {
      logger.warn('Circuit breaker state transition', { from: previous, to: state });
      this.emit('stateChange', { from: previous, to: state });
    }
  }
}
