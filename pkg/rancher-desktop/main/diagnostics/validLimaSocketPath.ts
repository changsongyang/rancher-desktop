import os from 'os';
import path from 'path';

import mainEvents from '@pkg/main/mainEvents';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';

import type { DiagnosticsCategory, DiagnosticsChecker, DiagnosticsCheckerResult } from './types';

const console = Logging.diagnostics;

const ValidLimaSocketPathChecker: DiagnosticsChecker = {
  id:       'VALID_LIMA_SOCKET_PATH',
  category: 'Kubernetes' as DiagnosticsCategory,
  async applicable(): Promise<boolean> {
    const settings = await mainEvents.invoke('settings-fetch');

    console.debug(`${ this.id }: Kubernetes enabled? ${ settings.kubernetes.enabled }`);

    return settings.kubernetes.enabled && ['darwin', 'linux'].includes(os.platform());
  },
  check(): Promise<DiagnosticsCheckerResult> {
    const limaDirPath = paths.lima;
    const limaFullPath = path.join(limaDirPath, '0', 'ssh.sock.1234567890123456');
    const maxSizes = { darwin: 104, linux: 106 };
    const platformMaxSize = maxSizes[os.platform() as 'darwin'|'linux'];
    const passed = limaFullPath.length <= platformMaxSize;
    let description = 'Unknown issue determining valid lima path length.';

    console.debug(`${ this.id }: using lima path of ${ limaFullPath.length }, max is ${ platformMaxSize }`);
    if (passed) {
      description = 'The lima path is valid.';
    } else {
      const altName = path.join(os.homedir(), '.rdlima', '0', 'ssh.sock.1234567890123456');

      if (altName.length <= platformMaxSize) {
        description = `The lima path ${ limaFullPath } is too long and can be moved to ~/.rdlima`;
      } else {
        description = `This application will need to be run on a machine with a shorter username than "${ os.userInfo().username }"`;
      }
    }

    return Promise.resolve({
      description,
      fixes: [],
      passed,
    });
  },
};

export default ValidLimaSocketPathChecker;
