import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import * as wikiLinkMod from 'remark-wiki-link';
import * as calloutMod from 'remark-obsidian-callout';
import fs from 'node:fs';
import path from 'node:path';

const wikiLinkPlugin = wikiLinkMod.wikiLinkPlugin ?? wikiLinkMod.default ?? wikiLinkMod;
const remarkObsidianCallout = calloutMod.default ?? calloutMod;

const KB = path.resolve('../knowledge-base');
const FOLDERS = ['concepts', 'components', 'frameworks', 'comparisons'];
const slugToPermalink = {};
const permalinks = [];
for (const folder of FOLDERS) {
  const dir = path.join(KB, folder);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const base = f.replace(/\.md$/, '');
    if (base === '_index') {
      slugToPermalink[`${folder}/_index`] = folder;
      slugToPermalink[folder] = folder;
      permalinks.push(folder);
    } else {
      const permalink = `${folder}/${base}`;
      slugToPermalink[base.toLowerCase()] = permalink;
      slugToPermalink[`${folder}/${base}`.toLowerCase()] = permalink;
      permalinks.push(permalink);
    }
  }
}

const resolve = (name) => {
  const key = String(name).replace(/\\/g, '').replace(/#.*$/, '').trim().toLowerCase();
  const hit = slugToPermalink[key] ?? slugToPermalink[key.split('/').pop()];
  return [hit ?? key.split('/').pop()];
};

export default defineConfig({
  site: 'https://agent-design-atlas.c01dkit.com',
  integrations: [mdx()],
  markdown: {
    remarkPlugins: [
      remarkObsidianCallout,
      [wikiLinkPlugin, {
        permalinks,
        pageResolver: resolve,
        hrefTemplate: (permalink) => `/${permalink}/`,
        aliasDivider: '|',
        wikiLinkClassName: 'wikilink',
        newClassName: 'wikilink-new',
      }],
    ],
    shikiConfig: { theme: 'github-dark', wrap: true },
  },
});
