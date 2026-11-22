// Multipart upload limits shared by the upload interceptors (busboy limits).
export const FILE_UPLOAD_MAX_FILES = 1;
export const FILE_UPLOAD_MAX_FIELDS = 2;
export const FILE_UPLOAD_FIELD_SIZE_BYTES = 256;
export const FILE_UPLOAD_MAX_PARTS = 3;

// File name / MIME validation caps (DTO) and object-key sanitizer truncation.
export const FILE_NAME_MAX_LENGTH = 255;
export const FILE_MIME_TYPE_MAX_LENGTH = 255;
export const FILE_NAME_SANITIZE_MAX_LENGTH = 100;
