function normalizeText(value = '') {
  return String(value || '').trim();
}

function toExhibitLabel(index) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let value = index;
  let label = '';

  do {
    label = alphabet[value % 26] + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);

  return `Exhibit ${label}`;
}

function normalizeItem(item) {
  if (typeof item === 'string') {
    return {
      title: normalizeText(item),
      description: normalizeText(item),
      status: 'provided'
    };
  }

  if (!item || typeof item !== 'object') {
    return null;
  }

  return {
    title: normalizeText(item.title || item.filename || item.label || item.summary || item.description),
    description: normalizeText(item.description || item.summary || item.extractedText || item.notes || item.filename || ''),
    filename: normalizeText(item.filename || ''),
    status: normalizeText(item.status || item.kind || 'provided').toLowerCase() || 'provided'
  };
}

export function buildExhibitPacket({ providedItems = [], suggestedItems = [] } = {}) {
  const exhibits = [
    ...providedItems
      .map(item => normalizeItem(item))
      .filter(Boolean)
      .map(item => ({ ...item, status: 'provided' })),
    ...suggestedItems
      .map(item => normalizeItem(item))
      .filter(Boolean)
      .map(item => ({ ...item, status: 'suggested' }))
  ]
    .filter(item => item.title || item.description)
    .map((item, index) => ({
      label: toExhibitLabel(index),
      title: item.title || item.description,
      description: item.description || item.title,
      filename: item.filename || null,
      status: item.status
    }));

  return {
    exhibits,
    exhibitIndex: exhibits.map(exhibit => `${exhibit.label}: ${exhibit.title}`),
    providedCount: exhibits.filter(exhibit => exhibit.status === 'provided').length,
    suggestedCount: exhibits.filter(exhibit => exhibit.status !== 'provided').length,
    recommendedPackageOrder: [
      'Dispute summary or cover note',
      'Dispute letter',
      'Exhibit index',
      ...exhibits.map(exhibit => exhibit.label)
    ]
  };
}
