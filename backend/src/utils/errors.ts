/** Error de dominio con codigo estable y status HTTP asociado. */
export class ErrorDominio extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
    readonly status = 400,
    readonly detalle?: unknown,
  ) {
    super(mensaje);
    this.name = 'ErrorDominio';
  }
}

export const noEncontrado = (que: string) =>
  new ErrorDominio('NO_ENCONTRADO', `${que} no encontrado`, 404);

export const conflicto = (codigo: string, mensaje: string) =>
  new ErrorDominio(codigo, mensaje, 409);

export const invalido = (codigo: string, mensaje: string, detalle?: unknown) =>
  new ErrorDominio(codigo, mensaje, 422, detalle);

export const noAutorizado = (mensaje = 'Credenciales invalidas') =>
  new ErrorDominio('NO_AUTORIZADO', mensaje, 401);
