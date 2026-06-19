function normalizePinFields(pin) {
  if (!pin) return pin;

  if (!pin.title && pin.text) {
    return {
      ...pin,
      title: pin.text,
      description: pin.description || "",
      reporter: pin.reporter || "",
    };
  }

  return {
    ...pin,
    title: pin.title || "",
    description: pin.description || "",
    reporter: pin.reporter || "",
  };
}

function getPinDisplayTitle(pin) {
  const normalized = normalizePinFields(pin);
  return normalized.title || normalized.description || "QA issue";
}
