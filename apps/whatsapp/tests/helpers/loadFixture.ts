import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load and parse a JSON fixture from tests/fixtures.
 *
 * Keeps fixtures out of production bundles and avoids
 * leaking paths in logs or error messages.
 */
export async function loadFixture<T = unknown>(relativePath: string): Promise<T> {
  const fixturePath = path.join(__dirname, '..', 'fixtures', relativePath);
  const contents = await readFile(fixturePath, 'utf-8');
  return JSON.parse(contents) as T;
}

/**
 * Return the raw JSON string for signature generation.
 */
export async function loadFixtureRaw(relativePath: string): Promise<string> {
  const fixturePath = path.join(__dirname, '..', 'fixtures', relativePath);
  return readFile(fixturePath, 'utf-8');
}
