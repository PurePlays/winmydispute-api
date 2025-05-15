document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('strategy-search');
  const results = document.getElementById('strategy-results');
  const hiddenCodeInput = document.getElementById('matched-strategy-code'); // optional hidden input
  const explanationBox = document.getElementById('strategy-explanation');

  let timeout = null;

  input.addEventListener('input', () => {
    clearTimeout(timeout);
    const query = input.value.trim();
    if (query.length < 2) return (results.innerHTML = '');

    timeout = setTimeout(async () => {
      try {
        console.log('[Search] User query:', query); // debug log
        const res = await fetch(`/api/v1/search-strategy?query=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (!Array.isArray(data)) return;

        results.innerHTML = data
          .slice(0, 5)
          .map(
            d => `
            <div class="strategy-result" data-code="${d.network}:${d.code}" data-title="${d.title}" data-strategy="${d.strategy?.customerStrategy || ''}">
              <strong>${d.network.toUpperCase()} ${d.code}</strong>: ${d.title || '(No title)'}
              <div class="strategy-preview">
                <small><strong>Strategy:</strong> ${d.strategy?.customerStrategy || 'N/A'}</small>
              </div>
            </div>`
          )
          .join('');

        document.querySelectorAll('.strategy-result').forEach(el => {
          el.addEventListener('click', () => {
            const code = el.dataset.code;
            const title = el.dataset.title;
            const strategy = el.dataset.strategy;

            if (hiddenCodeInput) hiddenCodeInput.value = code;
            if (explanationBox) {
              explanationBox.innerHTML = `
                <div class="gpt-explanation">
                  <strong>Why this match?</strong><br>
                  This dispute likely matches <code>${code}</code> – <em>${title}</em> because:<br>
                  <blockquote>${strategy}</blockquote>
                </div>`;
            }
          });
        });
      } catch (err) {
        console.error('Strategy search error:', err);
        results.innerHTML = '<div class="error">Error loading strategies.</div>';
      }
    }, 300);
  });
});