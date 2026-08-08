// Shared connection settings for every AWS service client in this console.
// Stored in localStorage so all services (SQS, SNS, ...) talk to the same
// endpoint with the same credentials, and the settings survive reloads.

export interface StoredSettings {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
}

export const SETTINGS_KEY = 'sqs-workbench:settings';

const DEFAULT_SETTINGS: StoredSettings = {
  endpoint: 'http://localhost:4566',
  region: 'us-east-1',
  accessKey: 'test',
  secretKey: 'test',
};

export function loadSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredSettings>;
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    /* corrupted storage — fall back to defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

export function storeSettings(s: StoredSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private browsing etc. — settings just won't persist */
  }
}
