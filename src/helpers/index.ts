export const get_env = (key: string, defaultValue?: string): string => {
  const value = process.env[key];

  if (value !== undefined && value !== "") {
    return value;
  }

  if (defaultValue !== undefined) {
    return defaultValue;
  }

  throw new Error(`Environment variable ${key} is not set`);
};

export const enumRecord = <T extends string>(value: readonly T[]): Record<string, T> =>
  Object.fromEntries(value.map((v) => [v, v])) as Record<string, T>;
