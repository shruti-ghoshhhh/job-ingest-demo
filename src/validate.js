/**
 * RemoteOK's feed returns a legal/metadata object as the first array
 * element and slightly inconsistent field names across listings (this is
 * realistic of real job boards, which is exactly the kind of "markup
 * changed overnight" fragility Part 1 asks us to survive).
 *
 * validateListing() never throws. A record that fails validation is
 * quarantined (returned with ok:false + reason) rather than dropped
 * silently or allowed to crash the batch.
 */
function validateListing(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'not_an_object', raw };
  }

  const id = raw.id || raw.slug;
  const title = raw.position || raw.title;
  const company = raw.company;
  const url = raw.url || raw.apply_url;

  const missing = [];
  if (!id) missing.push('id');
  if (!title) missing.push('title');
  if (!company) missing.push('company');
  if (!url) missing.push('url');

  if (missing.length > 0) {
    return { ok: false, reason: `missing_fields:${missing.join(',')}`, raw };
  }

  return {
    ok: true,
    listing: {
      id: String(id),
      title: String(title).trim(),
      company: String(company).trim(),
      location: raw.location ? String(raw.location).trim() : 'Remote',
      url: String(url).trim(),
      tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 8) : [],
      postedAt: raw.date || raw.epoch || null,
      fetchedAt: new Date().toISOString()
    }
  };
}

function validateBatch(rawArray) {
  const valid = [];
  const quarantined = [];

  for (const raw of Array.isArray(rawArray) ? rawArray : []) {
    const result = validateListing(raw);
    if (result.ok) {
      valid.push(result.listing);
    } else {
      quarantined.push(result);
    }
  }

  return { valid, quarantined };
}

module.exports = { validateListing, validateBatch };
