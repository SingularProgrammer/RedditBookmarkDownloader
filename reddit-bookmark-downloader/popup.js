let redditBookmarks = [];
let isRunning = false;
let stopRequested = false;
let doneCount = 0;
let failCount = 0;
let fileCount = 0;

const $ = id => document.getElementById(id);

function log(msg, type = 'info') {
  const icons = { success: 'OK', error: 'ERR', info: 'INFO', warn: 'WARN' };
  const div = document.createElement('div');
  div.className = `entry ${type}`;
  div.innerHTML = `<span class="icon">${icons[type] || '-'}</span><span class="text">${msg}</span>`;
  $('log').appendChild(div);
  $('log').scrollTop = $('log').scrollHeight;
}

function setStatus(msg, cls = '') {
  const el = $('status');
  el.textContent = msg;
  el.className = cls;
}

function updateStats() {
  $('statTotal').textContent = redditBookmarks.length;
  $('statDone').textContent = doneCount;
  $('statFail').textContent = failCount;
  $('statFiles').textContent = fileCount;
}

function setProgress(current, total) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  $('progressBar').style.width = pct + '%';
}

// Scan bookmarks
$('scanBtn').addEventListener('click', async () => {
  redditBookmarks = [];
  doneCount = 0; failCount = 0; fileCount = 0;
  $('log').innerHTML = '';
  updateStats();
  setStatus('Scanning bookmarks...', '');

  const tree = await browser.bookmarks.getTree();
  collectRedditLinks(tree);

  $('statTotal').textContent = redditBookmarks.length;

  if (redditBookmarks.length === 0) {
    setStatus('No Reddit bookmarks found.', 'err');
    return;
  }

  setStatus(`Found ${redditBookmarks.length} Reddit links.`, 'ok');
  log(`Found ${redditBookmarks.length} posts`, 'info');
  redditBookmarks.slice(0, 10).forEach(b => log(b.title || b.url, 'info'));
  if (redditBookmarks.length > 10) log(`... and ${redditBookmarks.length - 10} more`, 'info');

  $('downloadBtn').disabled = false;
  $('progressWrap').classList.add('visible');
  setProgress(0, redditBookmarks.length);
});

function collectRedditLinks(nodes) {
  for (const node of nodes) {
    if (node.url && isRedditUrl(node.url)) {
      redditBookmarks.push({ url: node.url, title: node.title || '' });
    }
    if (node.children) collectRedditLinks(node.children);
  }
}

function isRedditUrl(url) {
  return /reddit\.com\/r\/.+\/comments\//i.test(url) || url.includes('redd.it/');
}

// Start download
$('downloadBtn').addEventListener('click', async () => {
  if (isRunning) return;
  isRunning = true;
  stopRequested = false;
  doneCount = 0; failCount = 0; fileCount = 0;
  $('log').innerHTML = '';
  updateStats();

  $('downloadBtn').disabled = true;
  $('scanBtn').disabled = true;
  $('stopBtn').classList.add('visible');

  const folder = $('folderName').value.trim() || 'RedditDownloads';

  for (let i = 0; i < redditBookmarks.length; i++) {
    if (stopRequested) {
      setStatus('Stopped.', 'err');
      break;
    }

    const bookmark = redditBookmarks[i];
    setStatus(`[${i + 1}/${redditBookmarks.length}] Processing...`, '');
    setProgress(i + 1, redditBookmarks.length);

    const result = await browser.runtime.sendMessage({
      action: 'processPost',
      url: bookmark.url,
      title: bookmark.title,
      folder: folder
    });

    if (result && result.success) {
      doneCount++;
      fileCount += result.fileCount || 0;
      log(`${bookmark.title || bookmark.url} -> ${result.fileCount} files`, 'success');
    } else {
      failCount++;
      log(`ERROR: ${bookmark.title || bookmark.url} - ${result?.error || 'unknown'}`, 'error');
    }

    updateStats();

    // Short delay for rate limiting
    await sleep(600);
  }

  if (!stopRequested) setStatus('Completed.', 'ok');

  isRunning = false;
  $('scanBtn').disabled = false;
  $('stopBtn').classList.remove('visible');
  $('downloadBtn').disabled = false;
});

$('stopBtn').addEventListener('click', () => {
  stopRequested = true;
  setStatus('Stopping...', 'warn');
});

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}