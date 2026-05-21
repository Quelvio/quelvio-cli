export class QuelvioError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'QuelvioError';
    this.exitCode = exitCode;
  }
}
