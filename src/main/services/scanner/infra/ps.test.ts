// SPDX-License-Identifier: MPL-2.0

import type { ExecFileResult } from '@shared/exec-async';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFileAsync = vi.fn();
vi.mock('@shared/exec-async', () => ({
  execFileAsync: mockExecFileAsync,
}));

const { readExeInfosBatch } = await import('./ps');

beforeEach(() => {
  mockExecFileAsync.mockReset();
});

function psResult(stdout: string): ExecFileResult {
  return { stdout, stderr: '', errorMessage: null, errorCode: null };
}

function batchLine(path: string, failed: boolean): string {
  if (failed) return `${path}|`;
  return `${path}|1.2.3|1.2.3|Prod|Desc|Corp`;
}

describe('readExeInfosBatch', () => {
  it('reads PE info for a batch of exes with a single PowerShell spawn', async () => {
    const paths = ['C:\\A\\One.exe', 'C:\\B\\Two.exe', 'C:\\C\\Three.exe'];
    mockExecFileAsync.mockResolvedValueOnce(
      psResult(
        [
          'C:\\A\\One.exe|1.0.0|1.0.0|One|One desc|OneCorp',
          'C:\\B\\Two.exe|2.0.0|2.0.0|Two|Two desc|TwoCorp',
          'C:\\C\\Three.exe|3.0.0|3.0.0|Three|Three desc|ThreeCorp',
        ].join('\n'),
      ),
    );

    const map = await readExeInfosBatch(paths);

    expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
    expect([...map.keys()]).toEqual(paths);
    expect(map.get('C:\\A\\One.exe')).toMatchObject({
      version: '1.0.0',
      productName: 'One',
      fileDescription: 'One desc',
      companyName: 'OneCorp',
    });
  });

  it('splits into chunks of 30 and maps a failed path to null', async () => {
    const paths = Array.from({ length: 45 }, (_, i) => `C:\\App${i}\\App${i}.exe`);
    const fail = 'C:\\App7\\App7.exe';

    mockExecFileAsync
      .mockResolvedValueOnce(
        psResult(
          paths
            .slice(0, 30)
            .map((p) => batchLine(p, p === fail))
            .join('\n'),
        ),
      )
      .mockResolvedValueOnce(
        psResult(
          paths
            .slice(30)
            .map((p) => batchLine(p, false))
            .join('\n'),
        ),
      );

    const map = await readExeInfosBatch(paths);

    expect(mockExecFileAsync).toHaveBeenCalledTimes(2);
    expect(map.size).toBe(45);
    expect(map.get(fail)).toBeNull();
    expect(map.get('C:\\App0\\App0.exe')).toMatchObject({
      version: '1.2.3',
      productName: 'Prod',
      fileDescription: 'Desc',
      companyName: 'Corp',
    });
  });

  it('falls back to ProductVersion when FileVersion is empty', async () => {
    mockExecFileAsync.mockResolvedValueOnce(psResult('C:\\A\\One.exe||9.9.9|One|One desc|OneCorp'));

    const map = await readExeInfosBatch(['C:\\A\\One.exe']);

    expect(map.get('C:\\A\\One.exe')).toMatchObject({ version: '9.9.9' });
  });

  it('escapes single quotes in paths and keys the map by the exact path', async () => {
    const path = "C:\\O'Brien\\App.exe";
    mockExecFileAsync.mockResolvedValueOnce(psResult(`${path}|1.0.0|1.0.0|Prod|Desc|Corp`));

    const map = await readExeInfosBatch([path]);

    const args = mockExecFileAsync.mock.calls[0][1] as string[];
    expect(args[3]).toContain("O''Brien");
    expect(map.get(path)).toMatchObject({ version: '1.0.0', productName: 'Prod' });
  });
});
