export type SuccessResponse<T = never> = { success: true; message: string } & ([T] extends [never]
  ? { data?: undefined }
  : { data: T });

const successWithData = <T>(message: string, data: T): SuccessResponse<T> =>
  ({ success: true, message, data }) as SuccessResponse<T>;

export const ok = <T>(data: T): SuccessResponse<T> => successWithData("OK", data);

export const withMessage = <T>(data: T, message: string): SuccessResponse<T> =>
  successWithData(message, data);

export const messageOnly = (message: string): SuccessResponse => ({ success: true, message });

export const created = <T>(data: T, message: string): SuccessResponse<T> =>
  successWithData(message, data);
