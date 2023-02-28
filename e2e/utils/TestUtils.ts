/**
 * TestUtils exports functions required for the E2E test specs.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';

import { expect, _electron, ElectronApplication, Page } from '@playwright/test';
import _, { GetFieldType } from 'lodash';
import plist from 'plist';

import { defaultSettings, LockedSettingsType, Settings } from '@pkg/config/settings';
import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import * as childProcess from '@pkg/utils/childProcess';
import paths from '@pkg/utils/paths';
import { RecursivePartial, RecursiveTypes } from '@pkg/utils/typeUtils';

export async function createUserProfile(userProfile: RecursivePartial<Settings>|null, lockedFields:LockedSettingsType|null) {
  const platform: 'win32' | 'darwin' | 'linux' = os.platform() as 'win32' | 'darwin' | 'linux';

  if (platform === 'win32') {
    throw new Error(`Not doing win32 profiles yet`);
  } else if (platform === 'linux') {
    return await createLinuxUserProfile(userProfile, lockedFields);
  } else {
    return await createDarwinUserProfile(userProfile, lockedFields);
  }
}

export async function createLinuxUserProfile(userProfile: RecursivePartial<Settings>|null, lockedFields:LockedSettingsType|null) {
  const userProfilePath = path.join(paths.deploymentProfileUser, 'profile.json');
  const userLocksPath = path.join(paths.deploymentProfileUser, 'locked.json');

  if (userProfile) {
    await fs.promises.writeFile(userProfilePath, JSON.stringify(userProfile, undefined, 2));
  } else {
    await fs.promises.rm(userProfilePath, { force: true });
  }
  if (lockedFields) {
    await fs.promises.writeFile(userLocksPath, JSON.stringify(lockedFields, undefined, 2));
  } else {
    await fs.promises.rm(userLocksPath, { force: true });
  }
}

export async function createDarwinUserProfile(userProfile: RecursivePartial<Settings>|null, lockedFields:LockedSettingsType|null) {
  const userProfilePath = path.join(paths.deploymentProfileUser, 'io.rancherdesktop.profile.defaults.plist');
  const userLocksPath = path.join(paths.deploymentProfileUser, 'io.rancherdesktop.profile.locked.plist');

  if (userProfile) {
    await fs.promises.writeFile(userProfilePath, plist.build(userProfile));
  } else {
    await fs.promises.rm(userProfilePath, { force: true });
  }
  if (lockedFields) {
    await fs.promises.writeFile(userLocksPath, plist.build(lockedFields));
  } else {
    await fs.promises.rm(userLocksPath, { force: true });
  }
}

/**
 * Create empty default settings to bypass gracefully
 * FirstPage window.
 */
export function createDefaultSettings(overrides: RecursivePartial<Settings> = {}) {
  const defaultOverrides: RecursivePartial<Settings> = {
    kubernetes:  { enabled: true },
    application: {
      debug:                  true,
      pathManagementStrategy: PathManagementStrategy.Manual,
    },
  };
  const settingsData: Settings = _.merge({}, defaultSettings, defaultOverrides, overrides);

  const settingsJson = JSON.stringify(settingsData);
  const fileSettingsName = 'settings.json';
  const settingsFullPath = path.join(paths.config, fileSettingsName);

  if (!fs.existsSync(settingsFullPath)) {
    fs.mkdirSync(paths.config, { recursive: true });
    fs.writeFileSync(path.join(paths.config, fileSettingsName), settingsJson);
    console.log('Default settings file successfully created on: ', `${ paths.config }/${ fileSettingsName }`, settingsData);
  } else {
    try {
      const contents = fs.readFileSync(settingsFullPath, { encoding: 'utf-8' });
      const settings: Settings = JSON.parse(contents.toString());
      const desiredSettings: Settings = _.merge({}, settings, defaultOverrides, overrides);

      if (!_.eq(settings, desiredSettings)) {
        fs.writeFileSync(settingsFullPath, JSON.stringify(desiredSettings), { encoding: 'utf-8' });
      }
    } catch (err) {
      console.log(`Failed to process ${ settingsFullPath }: ${ err }`);
    }
  }
}

/**
 * getAlternateSetting returns the setting that isn't the same as the existing setting.
 */
export function getAlternateSetting<K extends keyof RecursiveTypes<Settings>>(currentSettings: Settings, setting: K, altOne: GetFieldType<Settings, K>, altTwo: GetFieldType<Settings, K>) {
  return _.get(currentSettings, setting) === altOne ? altTwo : altOne;
}

/**
 * Calculate the path of an asset that should be attached to a test run.
 * @param testPath The path to the test file.
 * @param type What kind of asset this is.
 */
export function reportAsset(testPath: string, type: 'trace' | 'log' = 'trace') {
  const name = {
    trace: 'pw-trace.zip',
    log:   'logs',
  }[type];

  // Note that CirrusCI doesn't upload folders...
  return path.join(__dirname, '..', 'reports', `${ path.basename(testPath) }-${ name }`);
}

export async function packageLogs(testPath: string) {
  if (!process.env.CIRRUS_CI) {
    console.log('Skipping packaging logs, not running in Cirrus CI');

    return;
  }
  const logDir = reportAsset(testPath, 'log');
  const outputPath = path.join(__dirname, '..', 'reports', `${ path.basename(testPath) }-logs.tar`);

  console.log(`Packaging logs to ${ outputPath }...`);
  await childProcess.spawnFile('tar', ['cfh', outputPath, '.'], { cwd: logDir, stdio: 'inherit' });
}

export async function teardown(app: ElectronApplication, filename: string) {
  const context = app.context();
  const proc = app.process();
  const pid = proc.pid;

  try {
    await context.tracing.stop({ path: reportAsset(filename) });
    await packageLogs(filename);
    await app.close();
  } finally {
    if (proc.kill('SIGTERM') || proc.kill('SIGKILL')) {
      console.log(`Manually stopped process ${ pid }`);
    }
  }
}

/**
 * helm teardown
 * it ensure that all helm test installation contents will be deleted.
 */
export async function tearDownHelm() {
  await helm('repo', 'remove', 'bitnami');
  await kubectl('delete', 'deploy', 'nginx-sample', '--namespace', 'default');
}

export function getFullPathForTool(tool: string): string {
  const srcDir = path.dirname(__dirname);
  const filename = os.platform().startsWith('win') ? `${ tool }.exe` : tool;

  return path.join(srcDir, '..', 'resources', os.platform(), 'bin', filename);
}

/**
 * Run the given tool with the given arguments, returning its standard output.
 */
export async function tool(tool: string, ...args: string[]): Promise<string> {
  const exe = getFullPathForTool(tool);

  try {
    const { stdout } = await childProcess.spawnFile(
      exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    return stdout;
  } catch (ex:any) {
    console.error(`Error running ${ tool } ${ args.join(' ') }`);
    console.error(`stdout: ${ ex.stdout }`);
    console.error(`stderr: ${ ex.stderr }`);
    // This expect(...).toBeUndefined() will always fail; we just want to make
    // playwright print out the stdout and stderr along with the message.
    // Normally, it would just print out `ex.toString()`, which mostly just says
    // "<command> exited with code 1" and doesn't explain _why_ that happened.
    expect({
      stdout: ex.stdout, stderr: ex.stderr, message: ex.toString(),
    }).toBeUndefined();
    throw ex;
  }
}

/**
 * Run `kubectl` with given arguments.
 * @returns standard output of the command.
 * @example await kubectl('version')
 */
export async function kubectl(...args: string[] ): Promise<string> {
  return await tool('kubectl', '--context', 'rancher-desktop', ...args);
}

/**
 * Run `helm` with given arguments.
 * @returns standard output of the command.
 * @example await helm('version')
 */
export async function helm(...args: string[] ): Promise<string> {
  return await tool('helm', '--kube-context', 'rancher-desktop', ...args);
}

export async function retry<T>(proc: () => Promise<T>, options?: { delay?: number, tries?: number }): Promise<T> {
  const delay = options?.delay ?? 500;
  const tries = options?.tries ?? 30;

  for (let i = 1; ; ++i) {
    try {
      return await proc();
    } catch (ex) {
      if (i >= tries) {
        console.log(`${ tries } tries exceeding, failing.`);
        throw ex;
      }
      console.error(`${ ex }, retrying... (${ i }/${ tries })`);
      await util.promisify(setTimeout)(delay);
    }
  }
}

/**
 * Run Rancher Desktop; return promise that resolves to commonly-used
 * playwright objects when it has started.
 * @param testPath The path to the test file.
 * @param tracing Whether to start tracing.
 */
export async function startRancherDesktop(testPath: string, tracing: boolean): Promise<{electronApp: ElectronApplication, page: Page}> {
  const electronApp = await _electron.launch({
    args: [
      path.join(__dirname, '../../'),
      '--disable-gpu',
      '--whitelisted-ips=',
      // See pkg/rancher-desktop/utils/commandLine.ts before changing the next item as the final option.
      '--disable-dev-shm-usage',
      '--no-modal-dialogs',
    ],
    env: {
      ...process.env,
      RD_LOGS_DIR:     reportAsset(testPath, 'log'),
      RD_MOCK_BACKEND: '1',
    },
  });

  if (tracing) {
    await electronApp.context().tracing.start({ screenshots: true, snapshots: true });
  }

  const page = await electronApp.firstWindow();

  return { electronApp, page };
}
