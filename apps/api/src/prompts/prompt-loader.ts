import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Prompt metadata extracted from frontmatter
 */
export interface PromptMetadata {
  version: string;
  name: string;
  description: string;
  model?: string;
  created?: string;
  changelog?: string;
}

/**
 * Compiled prompt template with metadata
 */
export interface CompiledPrompt {
  metadata: PromptMetadata;
  template: HandlebarsTemplateDelegate;
  source: string;
}

/**
 * PromptLoader: Load and cache versioned Handlebars templates
 *
 * Templates are stored in `prompts/v{N}/` directories with .hbs extension.
 * Each template has YAML frontmatter with metadata (version, name, description).
 *
 * Usage:
 *   const loader = new PromptLoader();
 *   const prompt = await loader.load('advisor-system', 'v1');
 *   const rendered = prompt.template({ contextKind: 'PROPERTY_SEARCH' });
 */
export class PromptLoader {
  private cache = new Map<string, CompiledPrompt>();
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || join(__dirname, '..');
  }

  /**
   * Load and compile a prompt template
   *
   * @param name - Template name (e.g., 'advisor-system')
   * @param version - Version directory (e.g., 'v1')
   * @returns Compiled prompt with metadata
   */
  load(name: string, version: string = 'v1'): CompiledPrompt {
    const key = `${version}/${name}`;

    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const path = join(this.baseDir, 'prompts', version, `${name}.hbs`);

    try {
      const source = readFileSync(path, 'utf-8');
      const { metadata, content } = this.parseFrontmatter(source);
      const template = Handlebars.compile(content, {
        noEscape: true, // Don't HTML-escape (we're generating plain text)
        strict: true,   // Error on missing variables
      });

      const compiled: CompiledPrompt = { metadata, template, source: content };
      this.cache.set(key, compiled);

      return compiled;
    } catch (error) {
      throw new Error(`Failed to load prompt ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get prompt metadata without compiling
   */
  getMetadata(name: string, version: string = 'v1'): PromptMetadata {
    const cached = this.cache.get(`${version}/${name}`);
    if (cached) return cached.metadata;

    const path = join(this.baseDir, 'prompts', version, `${name}.hbs`);
    const source = readFileSync(path, 'utf-8');
    return this.parseFrontmatter(source).metadata;
  }

  /**
   * List all available prompts in a version
   */
  list(version: string = 'v1'): PromptMetadata[] {
    const fs = require('fs');
    const dirPath = join(this.baseDir, 'prompts', version);

    if (!fs.existsSync(dirPath)) {
      return [];
    }

    const files = fs.readdirSync(dirPath)
      .filter((f: string) => f.endsWith('.hbs'));

    return files.map((file: string) => {
      const name = file.replace('.hbs', '');
      return this.getMetadata(name, version);
    });
  }

  /**
   * Clear the template cache (useful for hot-reloading in development)
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Parse YAML frontmatter from template source
   *
   * Frontmatter format:
   * ---
   * version: 1.0.0
   * name: advisor-system
   * description: Core system prompt
   * ---
   * Template content here...
   */
  private parseFrontmatter(source: string): { metadata: PromptMetadata; content: string } {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
    const match = source.match(frontmatterRegex);

    if (!match) {
      // No frontmatter, use defaults
      return {
        metadata: {
          version: '0.0.0',
          name: 'unknown',
          description: 'No metadata',
        },
        content: source,
      };
    }

    const [, frontmatter, content] = match;
    const metadata: PromptMetadata = {
      version: '0.0.0',
      name: 'unknown',
      description: 'No description',
    };

    // Parse YAML frontmatter (simple key: value pairs)
    frontmatter.split('\n').forEach(line => {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) return;

      const key = line.slice(0, colonIndex).trim() as keyof PromptMetadata;
      const value = line.slice(colonIndex + 1).trim();

      if (key in metadata) {
        (metadata as any)[key] = value;
      }
    });

    return { metadata, content: content.trim() };
  }
}

/**
 * Singleton instance for global use
 */
let defaultLoader: PromptLoader | null = null;

export function getPromptLoader(): PromptLoader {
  if (!defaultLoader) {
    defaultLoader = new PromptLoader();
  }
  return defaultLoader;
}
