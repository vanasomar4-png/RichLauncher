'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * Reads a JSON file. Missing or corrupt files yield `fallback`,
 * so a damaged settings file never prevents the launcher from starting.
 */
async function readJsonFile(filePath, fallback = null) {
  try {
    const text = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/**
 * Writes a file through a temporary file, so a crash never leaves a half-written file.
 * Each write gets its own temp name: two writes of the same file must not share one.
 */
async function writeFileAtomic(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fsp.writeFile(tempPath, data);
    await fsp.rename(tempPath, filePath);
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function writeJsonFileAtomic(filePath, value) {
  await writeFileAtomic(filePath, JSON.stringify(value, null, 2));
}

module.exports = { readJsonFile, writeJsonFileAtomic, writeFileAtomic };
