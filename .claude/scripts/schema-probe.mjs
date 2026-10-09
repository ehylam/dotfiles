// Browser-safe probe shared by inspect.mjs and focused parser checks.
// Syntax and declared types only, not Schema.org or rich-results eligibility.
export function inspectSchema(doc, requiredTypes = []) {
  const scripts = [...doc.querySelectorAll('script[type="application/ld+json"]')];
  const types = new Set();
  const errors = [];
  const blocks = [];
  const walk = (value, location) => {
    if (Array.isArray(value)) { value.forEach((item, i) => walk(item, `${location}[${i}]`)); return; }
    if (!value || typeof value !== 'object') return;
    if ('@type' in value) {
      const entries = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
      if (!entries.length || entries.some(type => typeof type !== 'string' || !type.trim())) {
        errors.push(`${location}: @type must be a non-empty string or string array`);
      } else {
        for (const type of entries) types.add(type.replace(/^https?:\/\/schema\.org\//, ''));
      }
    }
    for (const [key, item] of Object.entries(value)) {
      if (key !== '@context' && key !== '@type') walk(item, `${location}.${key}`);
    }
  };
  scripts.forEach((script, index) => {
    try {
      const value = JSON.parse(script.textContent.trim());
      if (!value || typeof value !== 'object') throw new Error('root must be an object or array');
      walk(value, `block[${index}]`);
      blocks.push({ index, parsed: true });
    } catch (error) {
      errors.push(`block[${index}]: ${error.message}`);
      blocks.push({ index, parsed: false });
    }
  });
  if (!scripts.length) errors.push('No JSON-LD blocks found');
  else if (!types.size) errors.push('No declared @type found');
  const missingTypes = requiredTypes.filter(type => !types.has(type));
  for (const type of missingTypes) errors.push(`Required type missing: ${type}`);
  return { valid: !errors.length, blockCount: scripts.length, types: [...types].sort(), missingTypes, blocks, errors };
}
