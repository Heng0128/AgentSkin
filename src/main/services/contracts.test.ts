// SPDX-License-Identifier: MPL-2.0

/**
 * # Service Contract Tests
 *
 * Verifies that mock implementations conform to the service interfaces
 * defined in contracts.ts. This ensures that:
 * 1. Mock objects used in tests accurately represent the real service contracts
 * 2. Interface changes are immediately reflected in test failures
 * 3. Type safety is maintained without `as any` casts
 */

import { describe, expect, it } from 'vitest';
import type {
  AgentEngineServiceApi,
  LoggerApi,
  SettingsServiceApi,
  ThemeLibraryApi,
  WallpaperResolver,
} from './contracts';
import {
  makeLoggerStub,
  makeSettingsStub,
  makeThemeLibraryStub,
  makeWallpaperResolverStub,
} from '../test-helpers/mock-services';

// ---------------------------------------------------------------------------
// Type conformity helpers
// ---------------------------------------------------------------------------

/**
 * Verify that a mock object satisfies the ThemeLibraryApi interface.
 * This is a compile-time check — if the mock doesn't match the interface,
 * TypeScript will report an error.
 */
function assertThemeLibraryApiConformity(mock: ThemeLibraryApi): void {
  // Verify all required methods exist and are functions
  expect(typeof mock.initialize).toBe('function');
  expect(typeof mock.entries).toBe('function');
  expect(typeof mock.summaries).toBe('function');
  expect(typeof mock.coverPathFor).toBe('function');
  expect(typeof mock.iconPathFor).toBe('function');
  expect(typeof mock.find).toBe('function');
  expect(typeof mock.installFile).toBe('function');
  expect(typeof mock.installBytes).toBe('function');
  expect(typeof mock.importPackage).toBe('function');
  expect(typeof mock.inspectPackage).toBe('function');
  expect(typeof mock.exportPackage).toBe('function');
  expect(typeof mock.delete).toBe('function');
}

/**
 * Verify that a mock object satisfies the SettingsServiceApi interface.
 */
function assertSettingsServiceApiConformity(mock: SettingsServiceApi): void {
  expect(typeof mock.initialize).toBe('function');
  expect(typeof mock.overridesFor).toBe('function');
  expect(typeof mock.wallpaper).toBe('function');
  expect(typeof mock.agentWallpaper).toBe('function');
  expect(typeof mock.toDto).toBe('function');
  expect(typeof mock.setAppPath).toBe('function');
  expect(typeof mock.setAppPort).toBe('function');
  expect(typeof mock.setWallpaper).toBe('function');
  expect(typeof mock.setAgentWallpaper).toBe('function');
  expect(typeof mock.customThemeCss).toBe('function');
  expect(typeof mock.setCustomThemeCss).toBe('function');
  expect(typeof mock.liveDomRefreshInterval).toBe('function');
  expect(typeof mock.setLiveDomRefreshInterval).toBe('function');
}

/**
 * Verify that a mock object satisfies the WallpaperResolver interface.
 */
function assertWallpaperResolverConformity(mock: WallpaperResolver): void {
  expect(typeof mock.videoPathFor).toBe('function');
  expect(typeof mock.mediaInfoFor).toBe('function');
  expect(typeof mock.webUrlFor).toBe('function');
}

/**
 * Verify that a mock object satisfies the LoggerApi interface.
 */
function assertLoggerApiConformity(mock: LoggerApi): void {
  expect(typeof mock.log).toBe('function');
  expect(typeof mock.logStructured).toBe('function');
}

// ---------------------------------------------------------------------------
// Contract conformity tests
// ---------------------------------------------------------------------------

describe('Service Contract Conformity', () => {
  describe('ThemeLibraryApi', () => {
    it('makeThemeLibraryStub conforms to ThemeLibraryApi interface', () => {
      const stub = makeThemeLibraryStub();
      assertThemeLibraryApiConformity(stub);
    });

    it('stub methods return expected default values', async () => {
      const stub = makeThemeLibraryStub();

      // Verify async methods return promises
      const entriesResult = stub.entries();
      expect(entriesResult).toBeInstanceOf(Promise);
      await entriesResult;

      const summariesResult = stub.summaries();
      expect(summariesResult).toBeInstanceOf(Promise);
      await summariesResult;

      const findResult = stub.find('test-theme');
      expect(findResult).toBeInstanceOf(Promise);
      await findResult;
    });

    it('stub sync methods return expected types', () => {
      const stub = makeThemeLibraryStub();

      // coverPathFor and iconPathFor should return string | null
      const coverResult = stub.coverPathFor('test-theme');
      expect(coverResult === null || typeof coverResult === 'string').toBe(true);

      const iconResult = stub.iconPathFor('test-theme');
      expect(iconResult === null || typeof iconResult === 'string').toBe(true);
    });
  });

  describe('SettingsServiceApi', () => {
    it('makeSettingsStub conforms to SettingsServiceApi interface', () => {
      const stub = makeSettingsStub();
      assertSettingsServiceApiConformity(stub);
    });

    it('stub methods return expected default values', async () => {
      const stub = makeSettingsStub();

      // Verify async methods return promises
      const initResult = stub.initialize();
      expect(initResult).toBeInstanceOf(Promise);
      await initResult;

      const setAppPathResult = stub.setAppPath('traework', '/path/to/app');
      expect(setAppPathResult).toBeInstanceOf(Promise);
      await setAppPathResult;
    });

    it('stub sync methods return expected types', () => {
      const stub = makeSettingsStub();

      // overridesFor should return { appPath, port }
      const overrides = stub.overridesFor('traework');
      expect(overrides).toHaveProperty('appPath');
      expect(overrides).toHaveProperty('port');

      // wallpaper should return WallpaperSettings shape
      const wallpaper = stub.wallpaper();
      expect(wallpaper).toHaveProperty('enabled');
      expect(wallpaper).toHaveProperty('id');

      // customThemeCss should return string
      const css = stub.customThemeCss();
      expect(typeof css).toBe('string');

      // liveDomRefreshInterval should return number
      const interval = stub.liveDomRefreshInterval();
      expect(typeof interval).toBe('number');
    });

    it('makeSettingsStub with options returns configured values', () => {
      const stub = makeSettingsStub({
        port: 9222,
        appPath: '/path/to/app',
      });

      const overrides = stub.overridesFor('traework');
      expect(overrides.port).toBe(9222);
      expect(overrides.appPath).toBe('/path/to/app');
    });
  });

  describe('WallpaperResolver', () => {
    it('makeWallpaperResolverStub conforms to WallpaperResolver interface', () => {
      const stub = makeWallpaperResolverStub();
      assertWallpaperResolverConformity(stub);
    });

    it('stub methods return expected default values', async () => {
      const stub = makeWallpaperResolverStub();

      // All methods should return promises
      const videoResult = stub.videoPathFor('test-wp');
      expect(videoResult).toBeInstanceOf(Promise);
      await videoResult;

      const mediaResult = stub.mediaInfoFor('test-wp');
      expect(mediaResult).toBeInstanceOf(Promise);
      await mediaResult;

      const webResult = stub.webUrlFor('test-wp');
      expect(webResult).toBeInstanceOf(Promise);
      await webResult;
    });
  });

  describe('LoggerApi', () => {
    it('makeLoggerStub conforms to LoggerApi interface', () => {
      const stub = makeLoggerStub();
      assertLoggerApiConformity(stub);
    });

    it('stub methods are callable without errors', () => {
      const stub = makeLoggerStub();

      // Should not throw
      stub.log('test message');
      stub.logStructured({
        type: 'boot_start',
        agentId: 'traework',
        timestamp: new Date().toISOString(),
      });
    });
  });
});

// ---------------------------------------------------------------------------
// AgentEngineServiceApi structural contract
// ---------------------------------------------------------------------------

describe('AgentEngineServiceApi Structural Contract', () => {
  it('AgentEngineServiceApi interface has all required methods defined', () => {
    // This test verifies the interface shape at the type level.
    // If any method is missing from the interface, TypeScript will fail to compile.
    const _interfaceCheck: Record<keyof AgentEngineServiceApi, true> = {
      setWallpaperService: true,
      setLogListener: true,
      asLogger: true,
      initialize: true,
      reconcileActiveThemes: true,
      status: true,
      apply: true,
      restore: true,
      restoreAll: true,
      applyAgentWallpaperNow: true,
      applyWallpaperToAgent: true,
      removeWallpaperFromAgent: true,
      collectConcurrencyMetrics: true,
      updateConcurrencyMetricsFromRenderer: true,
      startConcurrencyMetricsTimer: true,
      stopConcurrencyMetricsTimer: true,
      dispose: true,
      disposeAsync: true,
      lastPersistError: true,
    };

    expect(Object.keys(_interfaceCheck).length).toBeGreaterThan(0);
  });
});
