export function apiError(status, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  err.extra = extra;
  return err;
}

export function notFound(_req, _res, next) {
  next(apiError(404, "Not found"));
}

export function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  const body = { ok: false, error: err.message || "server_error" };
  if (err.extra && typeof err.extra === "object")
    Object.assign(body, err.extra);
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.status(status).json(body);
}
