const errorMiddleware = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  let statusCode =
    err.statusCode ||
    err.status ||
    (res.statusCode !== 200 ? res.statusCode : 500);
  let message = err.message || "Internal server error";

  if (err.name === "MulterError") {
    statusCode = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    message = err.code === "LIMIT_FILE_SIZE" ? "Images must be 5 MB or smaller" : "Too many images or an invalid upload field";
  } else if (err.code === 11000) {
    statusCode = 409;
    message = "A record with that value already exists";
  } else if (err.name === "ValidationError" || err.name === "CastError") {
    statusCode = 400;
  } else if (
    err.name === "JsonWebTokenError" ||
    err.name === "TokenExpiredError"
  ) {
    statusCode = 401;
  }

  if (statusCode >= 500) {
    // Do not log Stripe request objects, credentials, uploaded documents, or stack traces.
    console.error("Request failed", { name: err.name, statusCode, path: req.path });

    if (process.env.NODE_ENV === "production") {
      message = "Internal server error";
    }
  }

  return res.status(statusCode).json({
    success: false,
    message,
  });
};

export default errorMiddleware;
