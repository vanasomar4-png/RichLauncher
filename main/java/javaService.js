'use strict';

const { SerialQueue } = require('../core/serialQueue');
const { createTaskReporter } = require('../core/progressReporter');
const { getAppPaths } = require('../core/paths');
const { findJavaRuntimes } = require('./javaDetector');
const { installJava } = require('./javaInstaller');
const { resolveJavaRuntime } = require('./javaRuntimeService');

const installQueue = new SerialQueue();

/** Lists Java installations found on this PC and the ones managed by the launcher. */
async function listJavaRuntimes() {
  return findJavaRuntimes(getAppPaths().runtimesDirectory);
}

/** Downloads a Temurin JDK for the given major version (serialized with other installs). */
function installManagedJava(majorVersion) {
  if (!Number.isInteger(majorVersion) || majorVersion < 8 || majorVersion > 30) {
    throw new Error(`Java ${majorVersion} не поддерживается автоматической установкой.`);
  }
  return installQueue.run(async () => {
    const reporter = createTaskReporter({ taskId: `java:${majorVersion}`, kind: 'java', label: `Java ${majorVersion}` });
    try {
      reporter.report('Загрузка', 0, 'Temurin');
      const runtime = await installJava(majorVersion, {
        onProgress: (fraction) => reporter.report('Загрузка', fraction * 95, 'Temurin'),
      });
      reporter.finish('done', runtime.version);
      return runtime;
    } catch (error) {
      reporter.finish('error', error.message);
      throw error;
    }
  });
}

/**
 * Java for a game launch. When the runtime has to be downloaded, the download is
 * reported as a task so the Home screen can show its progress.
 */
async function resolveJavaForLaunch(requiredMajor, settings) {
  let reporter = null;
  try {
    const runtime = await resolveJavaRuntime({
      requiredMajor,
      settings,
      onProgress: (fraction) => {
        reporter ??= createTaskReporter({ taskId: `java:${requiredMajor}`, kind: 'java', label: `Java ${requiredMajor}` });
        reporter.report('Загрузка', fraction * 95, 'Temurin');
      },
    });
    reporter?.finish('done', runtime.version);
    return runtime;
  } catch (error) {
    reporter?.finish('error', error.message);
    throw error;
  }
}

module.exports = { listJavaRuntimes, installManagedJava, resolveJavaForLaunch };
