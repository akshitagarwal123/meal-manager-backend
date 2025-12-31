function shouldExposeErrors() {
  if (String(process.env.EXPOSE_ERRORS ?? '').toLowerCase() === 'true') return true;
  return String(process.env.NODE_ENV ?? '').toLowerCase() !== 'production';
}

function errorResponse({ req, publicError, err }) {
  const body = { error: publicError || 'Server error' };
  if (req?.requestId) body.request_id = req.requestId;
  if (shouldExposeErrors() && err) {
    body.details = err?.message || String(err);
  }
  return body;
}

function respondServerError(res, req, publicError, err) {
  return res.status(500).json(errorResponse({ req, publicError, err }));
}

module.exports = { shouldExposeErrors, errorResponse, respondServerError };
