import fs from 'fs';

import _ from 'lodash';

import * as configFileWrapper from '../configFileWrapper';
import * as settings from '../settings';
import { CacheMode, MountType, ProtocolVersion, SecurityModel } from '../settings';

import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import clone from '@pkg/utils/clone';
import paths from '@pkg/utils/paths';

class FakeFSError extends Error {
  public message = '';
  public code = '';
  constructor(message: string, code: string) {
    super(message);
    this.message = message;
    this.code = code;
  }
}

describe('settings', () => {
  let prefs: settings.Settings;
  let origPrefs: settings.Settings;
  const jsonProfile = JSON.stringify({
    ignoreThis:      { soups: ['gazpacho', 'turtle'] },
    containerEngine: {
      imageAllowList: {
        enabled:  true,
        patterns: ["Shouldn't see this"],
      },
    },
    kubernetes: { version: "Shouldn't see this" },
  });
  const plistProfile = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>containerEngine</key>
    <dict>
      <key>imageAllowList</key>
      <dict>
        <key>enabled</key>
        <true/>
        <key>not_schema</key>
        <true/>
        <key>locked</key>
        <true/>
        <key>patterns</key>
        <array/>
      </dict>
    </dict>
    <key>kubernetes</key>
    <dict>
      <key>version</key>
      <string>1.23.15</string>
      <key>containerEngine</key>
      <string>moby</string>
      <key>enabled</key>
      <true/>
    </dict>
    <key>testSettings</key>
    <dict>
      <key>testTitle</key>
      <string>test-title</string>
      <key>testStruct</key>
      <dict>
        <key>title</key>
        <string>test-struct</string>
        <key>subStruct</key>
        <dict>
          <key>title</key>
          <string>sub-title</string>
          <key>locked</key>
          <true/>
          <key>subvar</key>
          <string>sub-var</string>
        </dict>
      </dict>
    </dict>
    <key>debug</key>
    <true/>
    <key>diagnostics</key>
    <dict>
      <key>showMuted</key>
      <false/>
      <key>locked</key>
      <true/>
      <key>mutedChecks</key>
      <dict/>
    </dict>
  </dict>
</plist>`;
  const unlockedJSONProfile = JSON.stringify({
    ignoreThis:      { soups: ['beautiful', 'vichyssoise'] },
    containerEngine: { name: 'should be ignored' },
    kubernetes:      { version: "Shouldn't see this" },
  });
  const lockedJSONProfile = JSON.stringify({
    ignoreThis:      { soups: ['beautiful', 'vichyssoise'] },
    containerEngine: {
      imageAllowList: {
        enabled:  true,
        patterns: ['nginx', 'alpine'],
      },
    },
    kubernetes: { version: "Shouldn't see this" },
  });
  const unlockedPlistProfile = `
  <?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>kubernetes</key>
    <dict>
      <key>version</key>
      <string>Should be ignored</string>
    </dict>
  </dict>
</plist>
`;
  const lockedPlistProfile = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>version</key>
    <integer>4</integer>
    <key>containerEngine</key>
    <dict>
      <key>imageAllowList</key>
      <dict>
        <key>enabled</key>
        <true/>
        <key>not_schema</key>
        <true/>
        <key>patterns</key>
        <array>
        <string>nginx</string>
        <string>alpine</string>
        </array>
      </dict>
    </dict>
    <key>kubernetes</key>
    <dict>
      <key>version</key>
      <string>1.23.15</string>
      <key>containerEngine</key>
      <string>moby</string>
      <key>enabled</key>
      <true/>
    </dict>
    <key>testSettings</key>
    <dict>
      <key>testTitle</key>
      <string>test-title</string>
      <key>testStruct</key>
      <dict>
        <key>title</key>
        <string>test-struct</string>
        <key>subStruct</key>
        <dict>
          <key>title</key>
          <string>sub-title</string>
          <key>locked</key>
          <true/>
          <key>subvar</key>
          <string>sub-var</string>
        </dict>
      </dict>
    </dict>
    <key>debug</key>
    <true/>
    <key>diagnostics</key>
    <dict>
      <key>showMuted</key>
      <false/>
      <key>locked</key>
      <true/>
      <key>mutedChecks</key>
      <dict/>
    </dict>
  </dict>
</plist>
  `;
  const lockedAccessors = ['containerEngine.imageAllowList.enabled', 'containerEngine.imageAllowList.patterns'];
  let mock: any;
  // TODO: Stop doing this once profiles are implemented on windows
  const describeNotWindows = process.platform === 'win32' ? describe.skip : describe;

  beforeEach(() => {
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => { });
    prefs = {
      version:     6,
      application: {
        adminAccess:            true,
        debug:                  true,
        pathManagementStrategy: PathManagementStrategy.NotSet,
        telemetry:              { enabled: true },
        /** Whether we should check for updates and apply them. */
        updater:                { enabled: true },
        autoStart:              false,
        startInBackground:      false,
        hideNotificationIcon:   false,
        window:                 { quitOnClose: false },
      },
      containerEngine: {
        allowedImages: {
          enabled:  false,
          patterns: [],
        },
        name: settings.ContainerEngine.MOBY,
      },
      virtualMachine: {
        memoryInGB:   4,
        numberCPUs:   2,
        hostResolver: true,
      },
      experimental: {
        virtualMachine: {
          mount: {
            type: MountType.REVERSE_SSHFS,
            '9p': {
              securityModel:   SecurityModel.NONE,
              protocolVersion: ProtocolVersion.NINEP2000_L,
              msizeInKB:       128,
              cacheMode:       CacheMode.MMAP,
            },
          },
          socketVMNet: true,
        },
      },
      WSL:        { integrations: {} },
      kubernetes: {
        version: '1.23.5',
        port:    6443,
        enabled: true,
        options: {
          traefik: true,
          flannel: false,
        },
      },
      portForwarding: { includeKubernetesServices: false },
      images:         {
        showAll:   true,
        namespace: 'k8s.io',
      },
      diagnostics: {
        showMuted:   false,
        mutedChecks: {},
      },
    };
    origPrefs = clone(prefs);
    // Need to clear the lockedSettings field in tests because settings.load assumes it's initally an empty object.
    const keys = Object.keys(settings.lockedSettings);

    for (const k of keys) {
      delete settings.lockedSettings[k];
    }
  });

  describe('profiles', () => {
    describeNotWindows('locked fields', () => {
      function verifyAllFieldsAreLocked(lockedFields: settings.LockedSettingsType) {
        for (const acc of lockedAccessors) {
          expect(_.get(lockedFields, acc)).toBeTruthy();
        }
      }

      function verifyAllFieldsAreUnlocked(lockedFields: settings.LockedSettingsType) {
        for (const acc of lockedAccessors) {
          expect(_.get(lockedFields, acc)).toBeFalsy();
        }
      }

      // 0: no profile
      // 1: profile, unlocked
      // 2: profile: locked
      function createMocker(useSystemProfile: number, usePersonalProfile: number): (inputPath: string) => string {
        return (inputPath: string): string => {
          const action = inputPath.startsWith(paths.deploymentProfileSystem) ? useSystemProfile : usePersonalProfile;

          if (action === 0) {
            throw new FakeFSError(`File ${ inputPath } not found`, 'ENOENT');
          }
          if (inputPath.endsWith('defaults.json')) {
            return jsonProfile;
          }
          if (inputPath.endsWith('defaults.plist')) {
            return plistProfile;
          }
          switch (action) {
          case 1:
            if (inputPath.endsWith('locked.json')) {
              return unlockedJSONProfile;
            } else if (inputPath.endsWith('locked.plist')) {
              return unlockedPlistProfile;
            }
            break;
          case 2:
            if (inputPath.endsWith('locked.json')) {
              return lockedJSONProfile;
            } else if (inputPath.endsWith('locked.plist')) {
              return lockedPlistProfile;
            }
          }
          throw new Error("Shouldn't get here.");
        };
      }

      describe('when there is no profile', () => {
        beforeEach(() => {
          mock = jest.spyOn(configFileWrapper, 'readConfigFile')
            .mockImplementation(createMocker(0, 0));
        });
        afterEach(() => {
          mock.mockRestore();
        });
        test('all fields are unlocked', () => {
          settings.load();
          verifyAllFieldsAreUnlocked(settings.lockedSettings);
        });
      });

      describe('when there is only a user profile with unlocked imageList', () => {
        beforeEach(() => {
          mock = jest.spyOn(configFileWrapper, 'readConfigFile')
            .mockImplementation(createMocker(0, 1));
        });
        afterEach(() => {
          mock.mockRestore();
        });
        test('all fields are unlocked', () => {
          settings.load();
          verifyAllFieldsAreUnlocked(settings.lockedSettings);
        });
      });

      describe('when there is only a user profile with locked imageList', () => {
        beforeEach(() => {
          mock = jest.spyOn(configFileWrapper, 'readConfigFile')
            .mockImplementation(createMocker(0, 2));
        });
        afterEach(() => {
          mock.mockRestore();
        });
        test('all fields are locked', () => {
          settings.load();
          verifyAllFieldsAreLocked(settings.lockedSettings);
        });
      });

      describe('when there is only a system profile with unlocked imageList', () => {
        beforeEach(() => {
          mock = jest.spyOn(configFileWrapper, 'readConfigFile')
            .mockImplementation(createMocker(1, 0));
        });
        afterEach(() => {
          mock.mockRestore();
        });
        test('all fields are unlocked', () => {
          settings.load();
          verifyAllFieldsAreUnlocked(settings.lockedSettings);
        });
      });

      describe('when both profiles exit, both with unlocked imageList', () => {
        beforeEach(() => {
          mock = jest.spyOn(configFileWrapper, 'readConfigFile')
            .mockImplementation(createMocker(1, 1));
        });
        afterEach(() => {
          mock.mockRestore();
        });
        test('all fields are locked', () => {
          settings.load();
          verifyAllFieldsAreUnlocked(settings.lockedSettings);
        });
      });

      describe('when the system profile is unlocked and the user profile is locked', () => {
        beforeEach(() => {
          mock = jest.spyOn(configFileWrapper, 'readConfigFile')
            .mockImplementation(createMocker(1, 2));
        });
        afterEach(() => {
          mock.mockRestore();
        });
        test('all fields are locked', () => {
          settings.load();
          verifyAllFieldsAreUnlocked(settings.lockedSettings);
        });

        describe('when there is only a system profile with locked imageList', () => {
          beforeEach(() => {
            mock = jest.spyOn(configFileWrapper, 'readConfigFile')
              .mockImplementation(createMocker(2, 0));
          });
          afterEach(() => {
            mock.mockRestore();
          });
          test('all fields are locked', () => {
            settings.load();
            verifyAllFieldsAreLocked(settings.lockedSettings);
          });
        });

        describe('when both profiles exit, system locked, user unlocked', () => {
          beforeEach(() => {
            mock = jest.spyOn(configFileWrapper, 'readConfigFile')
              .mockImplementation(createMocker(2, 1));
          });
          afterEach(() => {
            mock.mockRestore();
          });
          test('all fields are locked', () => {
            settings.load();
            verifyAllFieldsAreLocked(settings.lockedSettings);
          });
        });

        describe('when both profiles exist and are locked', () => {
          beforeEach(() => {
            mock = jest.spyOn(configFileWrapper, 'readConfigFile')
              .mockImplementation(createMocker(2, 2));
          });
          afterEach(() => {
            mock.mockRestore();
          });
          test('all fields are locked', () => {
            settings.load();
            verifyAllFieldsAreLocked(settings.lockedSettings);
          });
        });
      });
    });
  });

  describe('lockableFields', () => {
    test('flattens an object with only allowed-image settings', () => {
      const lockedSettings = {
        containerEngine: {
          imageAllowList: {
            enabled:  true,
            patterns: ["Shouldn't see this"],
          },
        },
      };
      const expectedLockedFields = {
        containerEngine: {
          imageAllowList: {
            enabled:  true,
            patterns: true,
          },
        },
      };
      const calculatedLockedFields = {};

      settings.determineLockedFields(calculatedLockedFields, lockedSettings);
      expect(calculatedLockedFields).toEqual(expectedLockedFields);
    });
    test('flattens a complex object', () => {
      const lockedSettings = {
        virtualMachine: {
          memoryInGB: 2,
          numberCPUs: 2,
        },
        containerEngine: {
          imageAllowList: {
            enabled:  true,
            patterns: ["Shouldn't see this"],
          },
        },
        kubernetes: { version: '1.2.3' },
      };
      const expectedLockedFields = {
        virtualMachine: {
          memoryInGB: true,
          numberCPUs: true,
        },
        containerEngine: {
          imageAllowList: {
            enabled:  true,
            patterns: true,
          },
        },
        kubernetes: { version: true },
      };
      const calculatedLockedFields = {};

      settings.determineLockedFields(calculatedLockedFields, lockedSettings);
      expect(calculatedLockedFields).toEqual(expectedLockedFields);
    });
    test('flattens an empty object', () => {
      const lockedSettings = { };
      const expectedLockedFields = { };
      const calculatedLockedFields = {};

      settings.determineLockedFields(calculatedLockedFields, lockedSettings);
      expect(calculatedLockedFields).toEqual(expectedLockedFields);
    });
  });

  describe('getUpdatableNode', () => {
    test('returns null on an invalid top level accessor', () => {
      const result = settings.getUpdatableNode(prefs, 'blah-blah-blah');

      expect(result).toBeNull();
    });
    test('returns null on an invalid internal accessor', () => {
      const result = settings.getUpdatableNode(prefs, 'kubernetes-options-blah');

      expect(result).toBeNull();
    });
    test('returns the full pref with a top-level accessor', () => {
      const result = settings.getUpdatableNode(prefs, 'kubernetes') as [Record<string, any>, string];

      expect(result).not.toBeNull();
      const [lhs, accessor] = result;

      expect(lhs).toEqual(prefs);
      expect(accessor).toBe('kubernetes');
    });
    test('returns a partial pref with an internal accessor', () => {
      const result = settings.getUpdatableNode(prefs, 'kubernetes.options.flannel') as [Record<string, any>, string];

      expect(result).not.toBeNull();
      const [lhs, accessor] = result;
      const flannelNow = prefs.kubernetes.options.flannel;
      const flannelAfter = !flannelNow;

      expect(lhs).toEqual({
        ...origPrefs.kubernetes.options,
        flannel: flannelNow,
      });
      expect(accessor).toBe('flannel');
      lhs[accessor] = flannelAfter;
      expect(prefs.kubernetes.options.flannel).toBe(flannelAfter);
    });
  });

  describe('getObjectRepresentation', () => {
    test('handles more than 2 dots', () => {
      expect(settings.getObjectRepresentation('a.b.c.d', 3))
        .toMatchObject({ a: { b: { c: { d: 3 } } } });
    });
    test('handles 2 dots', () => {
      expect(settings.getObjectRepresentation('a.b.c', false))
        .toMatchObject({ a: { b: { c: false } } });
    });
    test('handles 1 dot', () => {
      expect(settings.getObjectRepresentation('first.last', 'middle'))
        .toMatchObject({ first: { last: 'middle' } });
    });
    test('handles 0 dots', () => {
      expect(settings.getObjectRepresentation('version', 4))
        .toMatchObject({ version: 4 });
    });
    test('complains about an invalid accessor', () => {
      expect(() => {
        settings.getObjectRepresentation('application.', 4);
      }).toThrow("Unrecognized command-line option ends with a dot ('.')");
    });
    test('complains about an empty-string accessor', () => {
      expect(() => {
        settings.getObjectRepresentation('', 4);
      }).toThrow("Invalid command-line option: can't be the empty string.");
    });
  });
});
