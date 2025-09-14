import { EventBridgeEvent, ScheduledEvent } from 'aws-lambda';

/**
 * Simple Lambda warmer utility
 * Can be called periodically to keep Lambda functions warm
 */

interface WarmupEvent {
  source: 'lambda-warmer';
  warmup: true;
}

/**
 * Check if this is a warmup event
 */
export function isWarmupEvent(event: any): event is WarmupEvent {
  return event && event.source === 'lambda-warmer' && event.warmup === true;
}

/**
 * Handle warmup event - just return early without processing
 */
export function handleWarmup(): void {
  console.log(JSON.stringify({
    level: 'INFO',
    message: 'Lambda warmer - keeping function warm',
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Wrapper for Lambda handlers to automatically handle warmup events
 */
export function withWarmup<T extends any[], R>(
  handler: (...args: T) => Promise<R>
): (...args: T) => Promise<R | void> {
  return async (...args: T): Promise<R | void> => {
    const [event] = args;
    
    if (isWarmupEvent(event)) {
      handleWarmup();
      return;
    }
    
    return handler(...args);
  };
}
