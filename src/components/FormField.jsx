export function FormField({
  label,
  required = false,
  error = "",
  hint = "",
  className = "",
  children,
}) {
  return (
    <label className={`field ${error ? "field--error" : ""} ${className}`}>
      <span className="field__label">
        {label}
        {required ? <span aria-hidden="true" className="field__required">*</span> : null}
      </span>
      {children}
      {error ? <span className="field__message">{error}</span> : null}
      {!error && hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}
