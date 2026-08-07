/**
 * Founder-attribution contract (GEO entity consolidation, 2026-08-07).
 *
 * index.html is the only thing non-JS-executing crawlers (and most LLM
 * retrieval bots) ever see for this SPA — the JSON-LD in <head> and the
 * <noscript> fallback ARE the page as far as they're concerned. This suite
 * pins the canonical entity spec: a Person node for Alex Bouchard and an
 * Organization node for MidnightDev, both with the exact cross-site @ids,
 * wired to the WebApplication node, plus a visible founder credit in the
 * <noscript> fallback. Sites merge in knowledge graphs because the @id is
 * identical everywhere — do not let any @id here drift from the spec.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it, beforeAll } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const PERSON_ID = 'https://midnightdev.dev/#alex-bouchard';
const ORG_ID = 'https://midnightdev.dev/#midnightdev';

const EXPECTED_SAME_AS = [
  'https://midnightdev.dev',
  'https://github.com/abouchard11',
  'https://www.linkedin.com/in/alex-bouchard-ai',
  'https://www.linkedin.com/in/alex-bouchard-70aa958',
  'https://dev.to/abouchard11',
  'https://x.com/alexbouchardd',
  'https://apps.apple.com/us/developer/alex-bouchard/id6774829905',
];

let html: string;
// Flattened list of every node found across every ld+json block in index.html
// (with @graph arrays flattened in), regardless of whether it's wrapped in an
// @graph or emitted as a bare top-level node.
let nodes: any[];

beforeAll(() => {
  html = readFileSync(resolve(REPO_ROOT, 'index.html'), 'utf-8');

  const blocks: any[] = [];
  const scriptRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(html)) !== null) {
    blocks.push(JSON.parse(match[1].trim()));
  }
  expect(blocks.length).toBeGreaterThan(0);

  nodes = blocks.flatMap((block) => (Array.isArray(block['@graph']) ? block['@graph'] : [block]));
});

function findById(id: string) {
  return nodes.find((n) => n['@id'] === id);
}

function findByType(type: string) {
  return nodes.find((n) => {
    const t = n['@type'];
    return t === type || (Array.isArray(t) && t.includes(type));
  });
}

describe('founder-attribution JSON-LD (index.html)', () => {
  it('defines the canonical Person node for Alex Bouchard with the exact spec @id', () => {
    const person = findById(PERSON_ID);
    expect(person).toBeDefined();
    expect(person['@type']).toBe('Person');
    expect(person.name).toBe('Alex Bouchard');
    expect(person.jobTitle).toBe('Forward-Deployed AI Lead');
  });

  it('alternateName is "Alex Bouchard AI"', () => {
    const person = findById(PERSON_ID);
    expect(person.alternateName).toBe('Alex Bouchard AI');
  });

  it('jobTitle never contains "engineer"/"engineering" (title rule)', () => {
    const person = findById(PERSON_ID);
    expect(person.jobTitle.toLowerCase()).not.toMatch(/engineer/);
  });

  it("Person node's sameAs is exactly the spec's 7-entry list", () => {
    const person = findById(PERSON_ID);
    expect(person.sameAs).toEqual(EXPECTED_SAME_AS);
  });

  it('defines the canonical Organization node for MidnightDev with the exact spec @id', () => {
    const org = findById(ORG_ID);
    expect(org).toBeDefined();
    expect(org['@type']).toBe('Organization');
    expect(org.name).toBe('MidnightDev');
  });

  it('Organization.founder references the Person @id', () => {
    const org = findById(ORG_ID);
    expect(org.founder).toEqual({ '@id': PERSON_ID });
  });

  it('WebApplication node has author/creator -> Person @id and publisher -> Org @id', () => {
    const webapp = findByType('WebApplication');
    expect(webapp).toBeDefined();
    expect(webapp.author).toEqual({ '@id': PERSON_ID });
    expect(webapp.creator).toEqual({ '@id': PERSON_ID });
    expect(webapp.publisher).toEqual({ '@id': ORG_ID });
  });

  it('no node anywhere in index.html defines a Person for Alex Bouchard under any other @id', () => {
    const rogue = nodes.filter(
      (n) =>
        n['@type'] === 'Person' &&
        typeof n.name === 'string' &&
        n.name.includes('Alex Bouchard') &&
        n['@id'] !== PERSON_ID
    );
    expect(rogue).toEqual([]);
  });

  it('the old yapword.com-scoped @id for Alex Bouchard is gone', () => {
    expect(html).not.toContain('https://yapword.com/#alex-bouchard');
  });
});

describe('visible founder credit (non-JS fallback)', () => {
  it('names Alex Bouchard and links to https://midnightdev.dev in the <noscript> fallback', () => {
    const noscriptMatch = html.match(/<noscript>([\s\S]*?)<\/noscript>/i);
    expect(noscriptMatch).not.toBeNull();
    const noscriptContent = noscriptMatch![1];
    expect(noscriptContent).toContain('Alex Bouchard');
    expect(noscriptContent).toMatch(/href=["']https:\/\/midnightdev\.dev["']/);
  });
});
