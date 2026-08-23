import { PromptMetadata } from './prompt-loader';

/**
 * Prompt Registry: Central configuration for all prompts in use
 *
 * Maps logical prompt names to their version and variant.
 * This allows changing prompt versions without modifying service code.
 */
export interface PromptConfig {
  name: string;
  version: string;
  variant?: string; // For A/B testing: 'control', 'experiment-a', etc.
}

export class PromptRegistry {
  private config: Map<string, PromptConfig> = new Map();

  constructor() {
    // Default configuration
    this.register('advisor-system', { name: 'advisor-system', version: 'v1', variant: 'control' });
    this.register('advisor-context', { name: 'advisor-context', version: 'v1', variant: 'control' });
    this.register('conversation-summary', { name: 'conversation-summary', version: 'v1', variant: 'control' });
  }

  /**
   * Register or update a prompt configuration
   */
  register(key: string, config: PromptConfig): void {
    this.config.set(key, config);
  }

  /**
   * Get configuration for a prompt
   */
  get(key: string): PromptConfig | undefined {
    return this.config.get(key);
  }

  /**
   * Get all registered prompts
   */
  list(): Array<[string, PromptConfig]> {
    return Array.from(this.config.entries());
  }

  /**
   * Override prompt version (for testing/rollback)
   */
  setVersion(key: string, version: string): void {
    const existing = this.config.get(key);
    if (existing) {
      this.config.set(key, { ...existing, version });
    }
  }

  /**
   * Override prompt variant (for A/B testing)
   */
  setVariant(key: string, variant: string): void {
    const existing = this.config.get(key);
    if (existing) {
      this.config.set(key, { ...existing, variant });
    }
  }
}

/**
 * Singleton instance
 */
let defaultRegistry: PromptRegistry | null = null;

export function getPromptRegistry(): PromptRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new PromptRegistry();
  }
  return defaultRegistry;
}
