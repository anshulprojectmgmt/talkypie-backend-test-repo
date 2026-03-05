const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sendValidationError(res, details) {
  return res.status(400).json({
    error: "Validation failed",
    details,
  });
}

export function validateSignupRequest(req, res, next) {
  const errors = [];
  const name = req.body?.name?.trim();
  const email = req.body?.email?.trim().toLowerCase();
  const password = req.body?.password;

  if (!name || name.length < 2 || name.length > 80) {
    errors.push("Name must be between 2 and 80 characters");
  }

  if (!email || !emailRegex.test(email)) {
    errors.push("A valid email is required");
  }

  if (!password || password.length < 8 || password.length > 128) {
    errors.push("Password must be between 8 and 128 characters");
  }

  if (password && (!/[A-Za-z]/.test(password) || !/\d/.test(password))) {
    errors.push("Password must include at least one letter and one number");
  }

  if (errors.length > 0) {
    return sendValidationError(res, errors);
  }

  req.body.name = name;
  req.body.email = email;
  next();
}

export function validateLoginRequest(req, res, next) {
  const errors = [];
  const email = req.body?.email?.trim().toLowerCase();
  const password = req.body?.password;

  if (!email || !emailRegex.test(email)) {
    errors.push("A valid email is required");
  }

  if (!password || typeof password !== "string") {
    errors.push("Password is required");
  }

  if (errors.length > 0) {
    return sendValidationError(res, errors);
  }

  req.body.email = email;
  next();
}

export function validateCreateAssistantRequest(req, res, next) {
  const errors = [];
  const childName = req.body?.childName?.trim();

  if (!childName) {
    errors.push("childName is required");
  } else if (childName.length > 100) {
    errors.push("childName cannot exceed 100 characters");
  }

  if (
    req.body?.age !== undefined &&
    req.body?.age !== null &&
    req.body?.age !== ""
  ) {
    const age = Number(req.body.age);
    if (!Number.isFinite(age) || age < 1 || age > 18) {
      errors.push("age must be a number between 1 and 18");
    }
  }

  if (errors.length > 0) {
    return sendValidationError(res, errors);
  }

  req.body.childName = childName;
  next();
}
