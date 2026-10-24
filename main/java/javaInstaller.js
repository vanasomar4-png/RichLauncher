'use strict';

const { spawn } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { downloadFile } = require('../core/fileDownloader');
const { createLogger } = require('../core/logger');
const { getAppPaths } = require('../core/paths');
const { probeJavaExecutable } = require('./javaDetector');

const log = createLogger('java-installer');

/** Adoptium (Eclipse Temurin) redirects to the latest GA JDK archive for the given major version. */
function adoptiumDownloadUrl(majorVersion) {
  return `https://api.adoptium.net/v3/binary/latest/${majorVersion}/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk`;
}

/**
 * Absolute path to the bsdtar that ships with Windows 10+. A bare "tar.exe" could
 * resolve to GNU tar from Git for Windows, which cannot read zip archives.
 */
function windowsTarPath() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
}

/**
 * Unpacks a zip with the bsdtar that ships with Windows 10+.
 * Runs inside the archive's folder with relative names: bsdtar reads "C:" in a
 * path as a remote host, so absolute Windows paths must not be passed to it.
 */
function runTarExtract(archivePath, targetDirectory) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      windowsTarPath(),
      ['-xf', path.basename(archivePath), '-C', path.basename(targetDirectory)],
      { cwd: path.dirname(archivePath), windowsHide: true },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Не удалось распаковать Java: ${stderr.trim()}`))));
  });
}

/** Finds the JDK root inside an extracted archive (the folder that contains bin\java.exe). */
async function findJdkRoot(extractedDirectory) {
  const entries = await fsp.readdir(extractedDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(extractedDirectory, entry.name);
    if (entry.isDirectory()) {
      try {
        await fsp.access(path.join(candidate, 'bin', 'java.exe'));
        return candidate;
      } catch {
        // Keep looking.
      }
    }
  }
  throw new Error('В архиве Java не найден bin\\java.exe.');
}

/** Installs in progress by major version: they share temp files, so a second request joins the first. */
const pendingInstalls = new Map();

/**
 * Downloads and unpacks a Temurin JDK into the managed runtimes folder.
 * `onProgress(fraction)` reports the download only; unpacking is short.
 * Returns the probed runtime {path, version, majorVersion, is64Bit}.
 */
function installJava(majorVersion, options = {}) {
  const pending = pendingInstalls.get(majorVersion);
  if (pending) {
    return pending;
  }
  const work = downloadAndUnpack(majorVersion, options).finally(() => pendingInstalls.delete(majorVersion));
  pendingInstalls.set(majorVersion, work);
  return work;
}

async function downloadAndUnpack(majorVersion, { onProgress } = {}) {
  const { runtimesDirectory, tempDirectory } = getAppPaths();
  const archivePath = path.join(tempDirectory, `temurin-${majorVersion}.zip`);
  const extractDirectory = path.join(tempDirectory, `temurin-${majorVersion}-extract`);
  const targetDirectory = path.join(runtimesDirectory, `java-${majorVersion}`);

  log.info(`Загрузка Java ${majorVersion}`);
  await fsp.mkdir(tempDirectory, { recursive: true });
  await downloadFile(adoptiumDownloadUrl(majorVersion), archivePath, {
    deepVerify: false,
    retries: 2,
    onProgress: (received, total) => {
      if (total) {
        onProgress?.(received / total);
      }
    },
  });

  await fsp.rm(extractDirectory, { recursive: true, force: true });
  await fsp.mkdir(extractDirectory, { recursive: true });
  await runTarExtract(archivePath, extractDirectory);
  const jdkRoot = await findJdkRoot(extractDirectory);

  await fsp.rm(targetDirectory, { recursive: true, force: true });
  await fsp.mkdir(runtimesDirectory, { recursive: true });
  await fsp.rename(jdkRoot, targetDirectory);
  await fsp.rm(extractDirectory, { recursive: true, force: true });
  await fsp.rm(archivePath, { force: true });

  const runtime = await probeJavaExecutable(path.join(targetDirectory, 'bin', 'java.exe'));
  if (!runtime) {
    throw new Error(`Установленная Java ${majorVersion} не запускается.`);
  }
  log.info(`Java ${runtime.version} установлена в ${targetDirectory}`);
  return runtime;
}

module.exports = { installJava, adoptiumDownloadUrl };
