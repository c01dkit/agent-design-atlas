import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

// No explicit schema: frontmatter across 50 agent-authored notes is heterogeneous.
// We read fields defensively in templates instead of failing the build on variance.
const make = (folder: string) =>
  defineCollection({
    loader: glob({ pattern: '**/*.md', base: `../knowledge-base/${folder}` }),
  });

export const collections = {
  concepts: make('concepts'),
  components: make('components'),
  frameworks: make('frameworks'),
  comparisons: make('comparisons'),
};
