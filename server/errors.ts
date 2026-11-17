export class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, message: string, code = 'error') {
    super(message)
    this.status = status
    this.code = code
  }
}
