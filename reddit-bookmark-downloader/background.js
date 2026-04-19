// Main message listener
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'processPost') {
    processPost(message.url, message.title, message.folder)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; 
  }
});

async function processPost(postUrl, title, folder) {
  const url = await resolveUrl(postUrl);

  const apiUrl = url.replace(/[?#].*$/, '').replace(/\/?$/, '') + '.json?raw_json=1';

  let data;
  try {
    const resp = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Firefox Reddit Downloader Extension)',
        'Accept': 'application/json'
      }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    data = await resp.json();
  } catch (e) {
    throw new Error(`API error: ${e.message}`);
  }

  const post = data[0]?.data?.children?.[0]?.data;
  if (!post) throw new Error('Could not retrieve post data');

  const mediaItems = extractAllMedia(post);
  if (mediaItems.length === 0) throw new Error('No downloadable media found');

  const baseFilename = sanitizeFilename(post.title || title || post.id);
  let downloadedCount = 0;

  for (const item of mediaItems) {
    try {
      await downloadItem(item, baseFilename, post.id, folder);
      downloadedCount++;
    } catch (e) {
      console.error('Download error:', e, item);
    }
  }

  return { success: true, fileCount: downloadedCount };
}

// Extract all media
function extractAllMedia(post) {
  const items = [];

  // 1) Reddit Gallery
  if (post.is_gallery && post.gallery_data && post.media_metadata) {
    const orderedIds = post.gallery_data.items.map(i => i.media_id);
    orderedIds.forEach((mediaId, idx) => {
      const meta = post.media_metadata[mediaId];
      if (!meta || meta.status !== 'valid') return;

      if (meta.e === 'Image') {
        // Highest quality image
        const src = meta.s?.u || meta.s?.gif;
        if (src) {
          items.push({
            type: 'image',
            url: src,
            index: idx + 1,
            ext: mimeToExt(meta.m) || 'jpg'
          });
        }
      } else if (meta.e === 'AnimatedImage') {
        const gifUrl = meta.s?.gif || meta.s?.mp4;
        if (gifUrl) {
          items.push({
            type: 'image',
            url: gifUrl,
            index: idx + 1,
            ext: gifUrl.includes('.mp4') ? 'mp4' : 'gif'
          });
        }
      } else if (meta.e === 'RedditVideo') {
        // Video inside gallery
        const dashUrl = meta.hlsUrl || meta.dashUrl;
        if (dashUrl) {
          items.push({ type: 'video_only', url: dashUrl, index: idx + 1, ext: 'mp4' });
        }
      }
    });
    return items;
  }

  // 2) Reddit Video (v.redd.it)
  if (post.is_video && post.media?.reddit_video) {
    const rv = post.media.reddit_video;
    const videoUrl = rv.fallback_url?.replace(/\?.*$/, ''); // clear query string

    if (videoUrl) {
      items.push({ type: 'video', url: videoUrl, index: 0, ext: 'mp4' });

      // Audio URL: DASH_480.mp4 -> DASH_audio.mp4
      // Try different audio formats sequentially
      const audioUrl = deriveAudioUrl(videoUrl);
      if (audioUrl) {
        items.push({ type: 'audio', url: audioUrl, index: 0, ext: 'mp4' });
      }
    }
    return items;
  }

  // 3) Crosspost / embed video (YouTube, Gfycat, etc. - save link only)
  if (post.media?.oembed) {
    const thumb = post.media.oembed.thumbnail_url;
    if (thumb) {
      items.push({ type: 'image', url: thumb, index: 0, ext: 'jpg', suffix: '_thumbnail' });
    }
    return items;
  }

  // 4) Single image (i.redd.it or direct link)
  if (post.url) {
    const imgMatch = post.url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i);
    if (imgMatch || post.url.includes('i.redd.it')) {
      items.push({
        type: 'image',
        url: post.url,
        index: 0,
        ext: imgMatch?.[1] || 'jpg'
      });
      return items;
    }

    // i.reddit.com
    if (post.url.includes('i.reddit.com')) {
      items.push({ type: 'image', url: post.url, index: 0, ext: 'jpg' });
      return items;
    }
  }

  // 5) Preview image (fallback)
  if (post.preview?.images?.[0]) {
    const img = post.preview.images[0];
    const src = img.source?.url;
    if (src) {
      items.push({ type: 'image', url: src, index: 0, ext: 'jpg' });
    }
  }

  return items;
}

// Derive audio URL
function deriveAudioUrl(videoUrl) {
  // https://v.redd.it/XXXXX/DASH_480.mp4 -> DASH_audio.mp4
  // https://v.redd.it/XXXXX/DASH_720.mp4 -> DASH_audio.mp4
  if (videoUrl.includes('DASH_')) {
    return videoUrl.replace(/DASH_\d+\.mp4/, 'DASH_audio.mp4');
  }
  // Alternative format: /video/XXXXX/DASH_360 -> /video/XXXXX/DASH_audio
  if (videoUrl.match(/\/DASH_\d+$/)) {
    return videoUrl.replace(/\/DASH_\d+$/, '/DASH_audio');
  }
  return null;
}

// Download item
async function downloadItem(item, baseFilename, postId, folder) {
  let filename = buildFilename(baseFilename, postId, item);
  const downloadPath = `${folder}/${filename}`;

  // Check if URL exists first for video (audio file might not exist)
  if (item.type === 'audio') {
    const exists = await checkUrlExists(item.url);
    if (!exists) {
      console.warn('Audio file not found:', item.url);
      return; // skip if no audio, don't count as error
    }
  }

  await browser.downloads.download({
    url: item.url,
    filename: downloadPath,
    conflictAction: 'uniquify',
    saveAs: false
  });
}

// Check if URL exists (HEAD request)
async function checkUrlExists(url) {
  try {
    const resp = await fetch(url, { method: 'HEAD' });
    return resp.ok;
  } catch {
    return false;
  }
}

// Build filename
function buildFilename(baseTitle, postId, item) {
  // Type prefix
  let prefix = '';
  if (item.type === 'video') prefix = '_video';
  else if (item.type === 'audio') prefix = '_audio';
  else if (item.suffix) prefix = item.suffix;

  // Gallery index
  const indexPart = item.index > 0 ? `_${String(item.index).padStart(3, '0')}` : '';

  return `${baseTitle}_${postId}${indexPart}${prefix}.${item.ext}`;
}

// Sanitize filename
function sanitizeFilename(title) {
  return title
    .replace(/[\\/:*?"<>|]/g, '_')   // Windows/Linux forbidden characters
    .replace(/\s+/g, '_')             // space -> underscore
    .replace(/_+/g, '_')              // multiple underscores -> single
    .replace(/^_|_$/g, '')            // remove leading/trailing underscores
    .substring(0, 80)                 // max 80 characters
    || 'reddit_post';
}

// MIME to extension
function mimeToExt(mime) {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4'
  };
  return map[mime] || null;
}

// Resolve URL redirect (redd.it short links)
async function resolveUrl(url) {
  if (!url.includes('redd.it') || url.includes('reddit.com')) return url;
  try {
    const resp = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return resp.url || url;
  } catch {
    return url;
  }
}