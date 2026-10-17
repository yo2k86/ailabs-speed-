const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=86400');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Pixabay API belum dikonfigurasi di server.' });
  }

  const q = String((req.query && req.query.q) || '').trim().slice(0, 100);
  const perPageRaw = Number((req.query && req.query.per_page) || 8);
  const perPage = Number.isFinite(perPageRaw) ? Math.max(3, Math.min(12, Math.floor(perPageRaw))) : 8;
  if (q.length < 2) {
    return res.status(400).json({ error: 'Kata kunci pencarian minimal 2 karakter.' });
  }

  const params = new URLSearchParams({
    key: apiKey,
    q,
    per_page: String(perPage),
    safesearch: 'true',
    order: 'popular'
  });
  const endpoint = 'https://pixabay.com/api/videos/?' + params.toString();

  try {
    const upstream = await new Promise((resolve, reject) => {
      const request = https.get(endpoint, { timeout: 9000, headers: { 'User-Agent': 'AILABS-Auto-Motion/1.0' } }, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; if (body.length > 2_000_000) request.destroy(new Error('Upstream response too large')); });
        response.on('end', () => resolve({ status: response.statusCode || 502, body }));
      });
      request.on('timeout', () => request.destroy(new Error('Pixabay request timed out')));
      request.on('error', reject);
    });

    let data;
    try { data = JSON.parse(upstream.body); } catch (_) { data = null; }

    if (upstream.status < 200 || upstream.status >= 300 || !data) {
      const message = data && data.error ? String(data.error) : 'Pixabay tidak bisa memproses pencarian saat ini.';
      return res.status(upstream.status >= 400 && upstream.status < 500 ? 502 : 502).json({ error: message });
    }

    const videos = (Array.isArray(data.hits) ? data.hits : []).map(hit => {
      const renditions = hit && hit.videos ? hit.videos : {};
      const rendition = renditions.medium && renditions.medium.url
        ? renditions.medium
        : renditions.small && renditions.small.url
          ? renditions.small
          : renditions.tiny && renditions.tiny.url
            ? renditions.tiny
            : null;
      if (!rendition) return null;
      const thumbnail = (renditions.tiny && renditions.tiny.thumbnail)
        || (renditions.small && renditions.small.thumbnail)
        || '';
      return {
        id: String(hit.id || ''),
        tags: String(hit.tags || ''),
        duration: Number(hit.duration) || 0,
        user: String(hit.user || 'Pixabay contributor'),
        pageURL: String(hit.pageURL || 'https://pixabay.com/videos/'),
        thumbnail,
        url: rendition.url,
        width: Number(rendition.width) || 0,
        height: Number(rendition.height) || 0
      };
    }).filter(video => video && video.url && video.id);

    return res.status(200).json({ source: 'Pixabay', query: q, totalHits: Number(data.totalHits) || 0, videos });
  } catch (error) {
    return res.status(502).json({
      error: error && error.message && error.message.includes('timed out')
        ? 'Pencarian Pixabay melewati batas waktu. Coba lagi sebentar.'
        : 'Gagal menghubungi Pixabay. Coba lagi nanti.'
    });
  }
};
